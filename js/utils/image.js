const MAX_SOURCE_SIZE = 15 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1280;
const JPEG_QUALITY = 0.78;

export async function compressReceipt(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Pilih file gambar untuk bukti pembayaran.');
  }
  if (file.size > MAX_SOURCE_SIZE) {
    throw new Error('Ukuran foto maksimal 15 MB.');
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(imageUrl);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Browser tidak bisa memproses gambar ini.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Gambar tidak bisa diperkecil. Coba pilih foto lain.'));
      }, 'image/jpeg', JPEG_QUALITY);
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Format gambar tidak didukung. Coba simpan sebagai JPG atau PNG.'));
    image.src = url;
  });
}
