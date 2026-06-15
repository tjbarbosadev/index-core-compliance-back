import { describe, it, expect } from 'vitest';
import { buildSteps } from './onboarding.service.js';

describe('onboarding.service', () => {
  it('buildSteps marks prior steps as concluido (SPEC-004)', () => {
    const steps = buildSteps(3);
    expect(steps).toHaveLength(6);
    expect(steps[0].status).toBe('concluido');
    expect(steps[1].status).toBe('concluido');
    expect(steps[2].status).toBe('em_andamento');
    expect(steps[3].status).toBe('pendente');
  });

  it('buildSteps starts at step 1 em_andamento', () => {
    const steps = buildSteps(1);
    expect(steps[0].status).toBe('em_andamento');
    expect(steps[1].status).toBe('pendente');
  });
});
