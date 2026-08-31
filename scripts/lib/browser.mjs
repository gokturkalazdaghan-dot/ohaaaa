/**
 * Tarayıcı başlatma — doğrulama betiklerinin ortak parçası.
 *
 * NEDEN AYRI BİR DOSYA
 * `playwright-core` tarayıcı İNDİRMEZ; yalnızca sürücüdür. Nereye bakacağını
 * kendi sürüm numarasından türetir ve o sürüm ortamda kurulu değilse
 * "Executable doesn't exist" deyip çıkar — sitede hiçbir şey bozuk olmasa da.
 * Bu, doğrulamanın kendisini kırılgan yapıyordu: iki betik de elle
 * `PLAYWRIGHT_CHROMIUM=...` verilmeden çalışmıyordu ve verilmediğinde hata,
 * bir arayüz hatası gibi görünüyordu.
 *
 * Çözüm sabit bir yol yazmak DEĞİL (o da tek makineye bağlar): önce
 * ortam değişkeni, sonra kurulu tarayıcıların bulunduğu dizinde arama,
 * en son playwright'ın kendi çözümlemesi denenir.
 */

import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Kurulu bir Chromium çalıştırılabiliri arar.
 *
 * `PLAYWRIGHT_BROWSERS_PATH` altındaki dizinler sürüm numarası taşır
 * (`chromium-1194` gibi) ve numara playwright sürümüyle birlikte değişir.
 * Bu yüzden numara ARANIR, yazılmaz.
 */
function findChromium() {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM;
  if (fromEnv) return fromEnv;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;

  /* Tam tarayıcı, "headless shell"den önce gelir: shell'de bazı özellikler
     (eklenti yüzeyi, bazı medya kod çözücüleri) eksiktir ve biz gerçek
     davranışı ölçüyoruz. */
  const candidates = readdirSync(root)
    .filter((name) => name.startsWith('chromium'))
    .sort((a, b) => Number(a.includes('headless')) - Number(b.includes('headless')));

  for (const dir of candidates) {
    for (const rel of [
      'chrome-linux/chrome',
      'chrome-linux/headless_shell',
      'chrome-headless-shell-linux64/chrome-headless-shell',
    ]) {
      const full = join(root, dir, rel);
      if (existsSync(full)) return full;
    }
    /* `/opt/pw-browsers/chromium` gibi doğrudan çalıştırılabilire işaret
       eden bir bağlantı da olabilir. */
    const direct = join(root, dir);
    if (!readdirSyncSafe(direct)) return direct;
  }

  return undefined;
}

function readdirSyncSafe(path) {
  try {
    return readdirSync(path);
  } catch {
    return null;
  }
}

/** Doğrulama betiklerinin kullandığı tek başlatma yolu. */
export async function launchBrowser() {
  const executablePath = findChromium();
  try {
    return await chromium.launch(executablePath ? { executablePath } : {});
  } catch (error) {
    throw new Error(
      `Chromium başlatılamadı.\n` +
        `Denenen yol: ${executablePath ?? '(playwright varsayılanı)'}\n` +
        `PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? '(tanımsız)'}\n\n` +
        `Bu bir SİTE hatası değil, ortam eksikliğidir. Kurulu bir Chromium'un\n` +
        `yolunu PLAYWRIGHT_CHROMIUM ile verin.\n\n` +
        `Özgün hata: ${error.message}`,
      { cause: error },
    );
  }
}
