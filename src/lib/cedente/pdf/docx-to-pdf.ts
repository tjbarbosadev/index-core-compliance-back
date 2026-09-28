import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from '../../env.js';

/** Converts a DOCX to PDF with headless LibreOffice (isolated profile per call). */
export async function docxToPdf(docxBytes: Uint8Array, baseName = 'documento'): Promise<Buffer> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'cedente-docx-'));
  const profileDir = path.join(workDir, 'profile');
  await mkdir(profileDir, { recursive: true });
  const docxPath = path.join(workDir, `${baseName}.docx`);
  await writeFile(docxPath, docxBytes);

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        env.sofficeBin,
        [
          '--headless',
          '--norestore',
          '--nologo',
          `-env:UserInstallation=file://${profileDir}`,
          '--convert-to',
          'pdf',
          '--outdir',
          workDir,
          docxPath,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stderr = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('LibreOffice excedeu o tempo limite de conversão'));
      }, 120_000);
      proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`LibreOffice indisponível (${env.sofficeBin}): ${err.message}`));
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`LibreOffice falhou (código ${code}): ${stderr.slice(0, 500)}`));
      });
    });

    return await readFile(path.join(workDir, `${baseName}.pdf`));
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
