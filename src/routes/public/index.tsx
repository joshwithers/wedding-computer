import { Hono } from 'hono'
import type { Env } from '../../types'
import availability from './availability'
import quote from './quote'
import directory from './directory'

const publicRoutes = new Hono<Env>()

publicRoutes.route('/', availability)
publicRoutes.route('/', quote)
publicRoutes.route('/', directory)

export default publicRoutes
