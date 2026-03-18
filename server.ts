/**
 * Orchestra Server — Standalone HTTP server
 * Lightweight replacement for Next.js API routes.
 */

import http from 'http'
import {
  createOrchestraTeam, getOrchestraTeam, listOrchestraTeams,
  getTeamFeed, sendTeamMessage, disbandTeam,
} from './services/orchestra-service'

const PORT = parseInt(process.env.ORCHESTRA_PORT || '23000', 10)

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const path = url.pathname
  const method = req.method || 'GET'

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  try {
    // Health check
    if (path === '/api/v1/health') {
      return json(res, { status: 'healthy', version: '1.0.0' })
    }

    // List teams / Create team
    if (path === '/api/orchestra/teams') {
      if (method === 'GET') {
        const result = listOrchestraTeams()
        return json(res, result.data, result.status)
      }
      if (method === 'POST') {
        const body = JSON.parse(await readBody(req))
        const result = await createOrchestraTeam(body)
        if (result.error) return json(res, { error: result.error }, result.status)
        return json(res, result.data, result.status)
      }
    }

    // Team operations: /api/orchestra/teams/:id
    const teamMatch = path.match(/^\/api\/orchestra\/teams\/([^/]+)$/)
    if (teamMatch) {
      const teamId = teamMatch[1]
      if (method === 'GET') {
        const result = getOrchestraTeam(teamId)
        if (result.error) return json(res, { error: result.error }, result.status)
        return json(res, result.data, result.status)
      }
      if (method === 'POST') {
        const body = JSON.parse(await readBody(req))
        const result = await sendTeamMessage(teamId, body.to || 'team', body.content, body.from)
        if (result.error) return json(res, { error: result.error }, result.status)
        return json(res, result.data, result.status)
      }
      if (method === 'DELETE') {
        const result = await disbandTeam(teamId)
        if (result.error) return json(res, { error: result.error }, result.status)
        return json(res, result.data, result.status)
      }
    }

    // Disband: /api/orchestra/teams/:id/disband
    const disbandMatch = path.match(/^\/api\/orchestra\/teams\/([^/]+)\/disband$/)
    if (disbandMatch && method === 'POST') {
      const result = await disbandTeam(disbandMatch[1])
      if (result.error) return json(res, { error: result.error }, result.status)
      return json(res, result.data, result.status)
    }

    // Feed: /api/orchestra/teams/:id/feed
    const feedMatch = path.match(/^\/api\/orchestra\/teams\/([^/]+)\/feed$/)
    if (feedMatch && method === 'GET') {
      const since = url.searchParams.get('since') || undefined
      const result = getTeamFeed(feedMatch[1], since)
      if (result.error) return json(res, { error: result.error }, result.status)
      return json(res, result.data, result.status)
    }

    json(res, { error: 'Not found' }, 404)
  } catch (err) {
    console.error('[Server] Error:', err)
    json(res, { error: 'Internal server error' }, 500)
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Orchestra] Server running on http://0.0.0.0:${PORT}`)
  console.log(`[Orchestra] Health: http://localhost:${PORT}/api/v1/health`)
})
