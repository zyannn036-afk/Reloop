"""
train_model.py - Melatih model klasifikasi sampah ReLoop (transfer learning)
lalu mengekspornya ke format TensorFlow.js supaya bisa jalan di browser.

STRUKTUR DATASET (nama folder = nama kategori):

    dataset/
    ├── organic/
    ├── plastic/
    ├── glass/
    ├── paper/
    └── other_inorganic/

CARA PAKAI:

    python train_model.py --dataset dataset --output ../model

HASIL (di folder --output):

    model.json, group1-shard1of1.bin (bisa lebih dari satu .bin), metadata.json

CATATAN VERSI (penting):
    Konverter TensorFlow.js paling stabil dengan Keras 2, yaitu TensorFlow 2.15.
    Jika instalasi bermasalah, pakai virtual environment baru atau Google Colab.

        pip install "tensorflow==2.15.*" tensorflowjs

Model input : gambar 224x224, piksel diskalakan ke -1..1
              (sama persis dengan yang dilakukan script.js di browser).
Model output: 5 probabilitas (softmax), urutan = urutan nama folder alfabet.
                glass, organic, other_inorganic, paper, plastic
              Urutan ini ditulis ke metadata.json, dan script.js membaca
              nama kelasnya dari sana.
"""

import argparse
import json
import os

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

IMG_SIZE = 224
EXPECTED_CLASSES = {"organic", "plastic", "glass", "paper", "other_inorganic"}
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp")


def parse_args():
    parser = argparse.ArgumentParser(description="Latih model klasifikasi sampah ReLoop")
    parser.add_argument("--dataset", default="dataset", help="folder dataset")
    parser.add_argument("--output", default="model", help="folder tujuan model TF.js")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--epochs-head", type=int, default=12, help="epoch tahap 1 (melatih lapisan akhir)")
    parser.add_argument("--epochs-finetune", type=int, default=8, help="epoch tahap 2 (fine-tuning)")
    return parser.parse_args()


def count_images(dataset_dir, class_names):
    """Hitung jumlah gambar tiap kelas (untuk bobot kelas)."""
    counts = []
    for name in class_names:
        folder = os.path.join(dataset_dir, name)
        files = [f for f in os.listdir(folder) if f.lower().endswith(IMAGE_EXTENSIONS)]
        counts.append(len(files))
    return counts


def main():
    args = parse_args()
    autotune = tf.data.AUTOTUNE

    # ---------------------------------------------------------------
    # 1. Membaca dataset: 80% untuk belajar (train), 20% untuk menguji (val)
    # ---------------------------------------------------------------
    common = dict(
        directory=args.dataset,
        validation_split=0.2,
        seed=123,  # seed sama supaya pembagian train/val konsisten
        image_size=(IMG_SIZE, IMG_SIZE),
        batch_size=args.batch_size,
        label_mode="int",
    )
    train_raw = keras.utils.image_dataset_from_directory(subset="training", **common)
    val_raw = keras.utils.image_dataset_from_directory(subset="validation", **common)

    class_names = train_raw.class_names
    print("Kelas ditemukan (urutan output model):", class_names)

    missing = EXPECTED_CLASSES - set(class_names)
    if missing:
        print("PERINGATAN: folder berikut tidak ditemukan:", sorted(missing))

    # Bobot kelas: kelas yang gambarnya sedikit diberi bobot lebih besar
    counts = count_images(args.dataset, class_names)
    total = sum(counts)
    class_weight = {i: total / (len(counts) * max(c, 1)) for i, c in enumerate(counts)}
    print("Jumlah gambar per kelas:", dict(zip(class_names, counts)))

    # ---------------------------------------------------------------
    # 2. Augmentasi (hanya untuk data latih) + skala piksel ke -1..1
    #    Augmentasi membuat model tahan terhadap sudut/cahaya berbeda.
    # ---------------------------------------------------------------
    augment = keras.Sequential(
        [
            layers.RandomFlip("horizontal"),
            layers.RandomRotation(0.1),
            layers.RandomZoom(0.15),
            layers.RandomContrast(0.15),
        ]
    )
    preprocess = keras.applications.mobilenet_v2.preprocess_input  # -> rentang -1..1

    train_ds = train_raw.map(
        lambda x, y: (preprocess(augment(x, training=True)), y),
        num_parallel_calls=autotune,
    ).prefetch(autotune)
    val_ds = val_raw.map(lambda x, y: (preprocess(x), y), num_parallel_calls=autotune).prefetch(autotune)

    # ---------------------------------------------------------------
    # 3. Membangun model: MobileNetV2 (sudah pintar mengenali bentuk/tekstur
    #    dari jutaan gambar ImageNet) + lapisan akhir baru untuk 5 kategori.
    #    Inilah "transfer learning".
    # ---------------------------------------------------------------
    base = keras.applications.MobileNetV2(
        input_shape=(IMG_SIZE, IMG_SIZE, 3), include_top=False, weights="imagenet"
    )
    base.trainable = False  # tahap 1: bagian pintar dibekukan

    x = layers.GlobalAveragePooling2D()(base.output)
    x = layers.Dropout(0.3)(x)
    outputs = layers.Dense(len(class_names), activation="softmax")(x)
    model = keras.Model(base.input, outputs)

    # ---------------------------------------------------------------
    # 4. Tahap 1 - latih lapisan akhir saja
    # ---------------------------------------------------------------
    model.compile(
        optimizer=keras.optimizers.Adam(1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    early_stop = keras.callbacks.EarlyStopping(
        monitor="val_accuracy", patience=4, restore_best_weights=True
    )
    model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=args.epochs_head,
        class_weight=class_weight,
        callbacks=[early_stop],
    )

    # ---------------------------------------------------------------
    # 5. Tahap 2 - fine-tuning: buka sebagian lapisan atas MobileNetV2
    #    dan latih pelan-pelan (learning rate kecil) agar makin akurat.
    # ---------------------------------------------------------------
    base.trainable = True
    for layer in base.layers[:-30]:
        layer.trainable = False
    for layer in base.layers:
        if isinstance(layer, layers.BatchNormalization):
            layer.trainable = False  # BatchNorm dibiarkan beku agar stabil

    model.compile(
        optimizer=keras.optimizers.Adam(1e-5),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=args.epochs_finetune,
        class_weight=class_weight,
        callbacks=[early_stop],
    )

    loss, accuracy = model.evaluate(val_ds)
    print(f"\nAkurasi pada data validasi: {accuracy * 100:.1f}%")

    # ---------------------------------------------------------------
    # 6. Ekspor ke TensorFlow.js + tulis metadata.json (daftar label)
    # ---------------------------------------------------------------
    import tensorflowjs as tfjs

    os.makedirs(args.output, exist_ok=True)
    tfjs.converters.save_keras_model(model, args.output)

    metadata = {
        "labels": class_names,
        "imageSize": IMG_SIZE,
        "normalization": "minus1_to_1",
        "validationAccuracy": round(float(accuracy), 4),
    }
    with open(os.path.join(args.output, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)

    print(f"\nSelesai. Salin isi folder '{args.output}' ke folder model/ di website.")


if __name__ == "__main__":
    main()
