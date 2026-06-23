/**
 * Collection Schemas — single source of truth, imported by worker + frontend.
 *
 * Doodle Chain keeps all live game state in the AppGameRoom Durable Object
 * (server-authoritative, broadcast over WebSocket), not in records — so the
 * only schema we register is the SDK-required `usersSchema`.
 */

import type { CollectionSchema } from 'deepspace/worker'
import { usersSchema } from './schemas/users-schema'

export const schemas: CollectionSchema[] = [usersSchema]
