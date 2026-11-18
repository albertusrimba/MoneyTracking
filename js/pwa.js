function waitWithTimeout(promise, milliseconds) {
  let timeout;
  const timer = new Promise((resolve, reject) => {
    timeout = window.setTimeout(() => reject(new Error('Service worker belum siap.')), milliseconds);
  });
  return Promise.race([promise, timer]).finally(() => window.clearTimeout(timeout));
}

export async function registerOfflineSupport(statusElement) {
  if (!('serviceWorker' in navigator)) {
    statusElement.textContent = 'Browser ini belum mendukung mode offline.';
    return;
  }

  statusElement.textContent = 'Menyiapkan akses offline...';
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'offline-ready') {
      statusElement.textContent = 'Aset aplikasi tersimpan untuk akses offline.';
    } else if (event.data?.type === 'offline-install-failed') {
      console.error('Gagal menyimpan aset offline:', event.data.message);
      statusElement.textContent = 'Mode offline gagal disiapkan. Coba muat ulang saat online.';
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    statusElement.textContent = 'Aset aplikasi tersimpan untuk akses offline.';
  }, { once: true });

  try {
    await waitWithTimeout(navigator.serviceWorker.register('./sw.js'), 15000);
    const registration = await waitWithTimeout(navigator.serviceWorker.ready, 15000);
    if (registration.active || navigator.serviceWorker.controller) {
      statusElement.textContent = 'Aset aplikasi tersimpan untuk akses offline.';
    }
    statusElement.textContent = 'Aset aplikasi tersimpan untuk akses offline.';
  } catch (error) {
    console.error('Gagal menyiapkan service worker:', error);
    statusElement.textContent = 'Mode offline belum siap. Buka kembali saat online.';
  }

  if (navigator.storage?.persist && navigator.storage?.persisted) {
    try {
      if (!(await navigator.storage.persisted())) {
        const granted = await navigator.storage.persist();
        if (!granted) console.info('Browser tidak menjamin penyimpanan tetap tersimpan.');
      }
    } catch (error) {
      console.error('Permintaan persistent storage gagal:', error);
    }
  }
}
