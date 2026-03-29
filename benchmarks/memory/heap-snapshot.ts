import { writeFile } from 'fs/promises';
import inspector from 'inspector';

export async function writeHeapSnapshot(outputPath: string): Promise<void> {
  const session = new inspector.Session();
  const chunks: string[] = [];

  session.connect();
  session.on('HeapProfiler.addHeapSnapshotChunk', event => {
    chunks.push(event.params.chunk);
  });

  await new Promise<void>((resolve, reject) => {
    session.post('HeapProfiler.takeHeapSnapshot', undefined, error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  session.disconnect();
  await writeFile(outputPath, chunks.join(''), 'utf8');
}
