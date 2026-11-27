// Type-checked only (npm run typecheck).
import { ArenyzeWebhooks, createTestEvent, type AnyArenyzeEvent } from '@arenyze/webhooks';

const webhooks = new ArenyzeWebhooks({ secret: 'whsec_x' });

webhooks.on('r6.rank_changed', (event) => {
  const rp: number = event.data.to.rp;
  const kd: string = event.data.to.kd;
  void rp; void kd;
});

webhooks.on('thefinals.league_changed', (event, ctx) => {
  const dir: 1 | -1 | 0 = event.data.direction;
  const delivery: string | null = ctx.deliveryId;
  void dir; void delivery;
});

webhooks.on('thefinals.*', (event) => {
  if (event.type === 'thefinals.ban_detected') {
    const label: string = event.data.banTypeLabel;
    void label;
  }
  // @ts-expect-error r6 events are not in the thefinals.* union
  if (event.type === 'r6.rank_changed') return;
});

webhooks.on('*', (event: AnyArenyzeEvent) => void event.text);

// @ts-expect-error unknown event type
webhooks.on('thefinals.typo', () => {});

const e = createTestEvent('endfield.level_changed', { data: { to: 60 } });
const level: number = e.data.to;
void level;

export const POST = webhooks.nextAppRouter();
