import { ensureStore } from './host/store.js'
import { createCore } from './host/core.js'
import { registerRoutes } from './host/routes.js'
import { registerAgent } from './host/agent.js'

export function apply(ctx, config) {
  ensureStore()
  const core = createCore(ctx, config ?? {})
  const offs = [
    registerRoutes(ctx, core),
    registerAgent(ctx, core),
    core.startObserver(),
  ]
  const cleanup = () => {
    for (const off of offs) {
      try {
        off()
      } catch {
        /* dispose defensively */
      }
    }
  }
  ctx.effect(() => cleanup, 'dsh-handshake: routes, commands, tools')
  return cleanup
}
