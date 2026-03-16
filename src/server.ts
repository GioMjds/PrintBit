import { PORT } from '@/config';
import {
  createKioskAppRuntime,
  getLocalIPv4,
  initializeInfrastructure,
} from '@/bootstrap';

const { server, io } = createKioskAppRuntime();

async function start() {
  await initializeInfrastructure(io);

  server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIPv4();
    if (localIP) {
      console.log(`→ Network: http://${localIP}:${PORT}`);
    } else {
      console.log('→ Network IP not detected');
    }
  });
}

start();
