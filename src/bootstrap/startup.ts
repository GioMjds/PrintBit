import type { Server } from 'socket.io';
import {
  initDB,
  detectDefaultPrinter,
  detectScanner,
  startScanStorageCleanup,
  initSerial,
  runHopperSelfTest,
  startPrinterMonitor,
  startClamd,
  startHotspot,
} from '@/services';

export async function initializeInfrastructure(io: Server): Promise<void> {
  await initDB();
  await detectDefaultPrinter();
  await detectScanner();
  startScanStorageCleanup();
  await initSerial(io);
  await runHopperSelfTest();

  startPrinterMonitor(io);

  await startClamd();
  await startHotspot();
}
