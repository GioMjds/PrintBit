import { SerialPort } from 'serialport';
import { db } from './db';
import { Server } from 'socket.io';

export async function initSerial(io: Server) {
  try {
    const ports = await SerialPort.list();

    if (!ports.length) {
      console.warn('No serial ports found. Continuing without serial connection.');
      return;
    }

    const portPath = ports[0].path;

    const port = new SerialPort({
      path: portPath,
      baudRate: 9600,
    });
  
    port.on('data', async (data) => {
      const value = parseInt(data.toString());
      if (isNaN(value)) return;
  
      db.data!.balance += value;
      await db.write();
  
      io.emit('balance', db.data!.balance);
    });

    console.log(`Serial port initialized on ${portPath}`);
  } catch {
    console.error('Error initializing serial port. Continuing without serial connection.');
  }
}