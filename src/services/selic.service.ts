import { prisma } from '../db/index.js';
import { toSelicFactor, toYYYYMMDD, parseYYYYMMDD, addDays } from './quota-calculator.js';

const BACEN_SERIE = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados?formato=json';
const BACEN_RETRIES = 4;
const BACEN_RETRY_DELAY_MS = 3000;

export type SelicSource = 'bacen' | 'fallback_db';

export type SelicEntry = {
  date: string;
  selicAnual: number;
  selicFactor: number;
  source: SelicSource;
};

export class SelicUnavailableError extends Error {
  constructor(message = 'SELIC indisponível: BACEN fora e histórico inexistente') {
    super(message);
    this.name = 'SelicUnavailableError';
  }
}

function ymdToBcb(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function bcbToYmd(data: string): string {
  const [d, m, y] = data.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

async function persistSelic(
  date: string,
  selicAnual: number,
  source: SelicSource,
): Promise<SelicEntry> {
  const selicFactor = toSelicFactor(selicAnual);
  await prisma.selicHistory.upsert({
    where: { date: parseYYYYMMDD(date) },
    update: {
      selicAnual,
      selicFator: selicFactor,
      source,
    },
    create: {
      date: parseYYYYMMDD(date),
      selicAnual,
      selicFator: selicFactor,
      source,
    },
  });
  return { date, selicAnual, selicFactor, source };
}

async function loadHistoryMap(dataFinal: string): Promise<Map<string, SelicEntry>> {
  const rows = await prisma.selicHistory.findMany({
    where: { date: { lte: parseYYYYMMDD(dataFinal) } },
    orderBy: { date: 'asc' },
  });
  const map = new Map<string, SelicEntry>();
  for (const row of rows) {
    const date = toYYYYMMDD(row.date);
    map.set(date, {
      date,
      selicAnual: Number(row.selicAnual),
      selicFactor: Number(row.selicFator),
      source: row.source as SelicSource,
    });
  }
  return map;
}

async function fetchFromBacen(
  dataInicial: string,
  dataFinal: string,
): Promise<Map<string, SelicEntry>> {
  const url = `${BACEN_SERIE}&dataInicial=${ymdToBcb(dataInicial)}&dataFinal=${ymdToBcb(dataFinal)}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= BACEN_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        lastError = new Error(`BACEN ${res.status}`);
        if (attempt < BACEN_RETRIES && (res.status === 502 || res.status === 503)) {
          await new Promise((r) => setTimeout(r, BACEN_RETRY_DELAY_MS));
          continue;
        }
        throw lastError;
      }
      const entries = (await res.json()) as { data: string; valor: string }[];
      const map = new Map<string, SelicEntry>();
      for (const e of entries ?? []) {
        const date = bcbToYmd(e.data);
        const selicAnual = parseFloat(e.valor);
        const entry = await persistSelic(date, selicAnual, 'bacen');
        map.set(date, entry);
      }
      return map;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < BACEN_RETRIES) {
        await new Promise((r) => setTimeout(r, BACEN_RETRY_DELAY_MS));
      }
    }
  }

  throw lastError ?? new Error('BACEN fetch failed');
}

/** Resolve Selic para uma data: BCB → senão último dia válido no banco. */
export function resolveSelicForDate(map: Map<string, SelicEntry>, dateStr: string): SelicEntry {
  let d = dateStr;
  while (d) {
    const v = map.get(d);
    if (v) {
      if (v.date !== dateStr) {
        return { ...v, source: 'fallback_db' };
      }
      return v;
    }
    const dt = parseYYYYMMDD(d);
    const prev = addDays(dt, -1);
    if (prev.getUTCFullYear() < 2000) break;
    d = toYYYYMMDD(prev);
  }
  throw new SelicUnavailableError(`SELIC indisponível para ${dateStr}`);
}

/**
 * Carrega mapa de Selic no intervalo. Tenta BCB; se falhar, usa banco.
 * Datas sem entrada usam o dia anterior válido via resolveSelicForDate.
 */
export async function getSelicMapForRange(
  dataInicial: string,
  dataFinal: string,
): Promise<Map<string, SelicEntry>> {
  try {
    const fromBacen = await fetchFromBacen(dataInicial, dataFinal);
    const fromDb = await loadHistoryMap(dataFinal);
    for (const [k, v] of fromDb) {
      if (!fromBacen.has(k)) fromBacen.set(k, v);
    }
    return fromBacen;
  } catch {
    const fallback = await loadHistoryMap(dataFinal);
    if (fallback.size === 0) {
      throw new SelicUnavailableError();
    }
    return fallback;
  }
}

/** Selic do dia do cálculo: BCB → fallback DB. */
export async function getSelicForCalculationDate(dateStr: string): Promise<SelicEntry> {
  const map = await getSelicMapForRange(dateStr, dateStr);
  return resolveSelicForDate(map, dateStr);
}
