// Thin fetch wrapper. No retry here; resilience lives in session-controller
// (the heartbeat supersedes losses). Resolves on 2xx, rejects with
// { status, message } otherwise.

import type { ScrobbleClient, ScrobblePayload, SettingsReader } from './types'

export function createScrobbleClient(settings: SettingsReader): ScrobbleClient {
  function request(method: string, path: string, body?: ScrobblePayload): Promise<unknown> {
    const token = settings.token
    if (!token) {
      return Promise.reject({ status: 0, message: 'no token' })
    }

    const headers: Record<string, string> = { Authorization: 'Bearer ' + token }
    const opts: RequestInit = { method, headers }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }

    return fetch(settings.baseUrl + path, opts).then(function (res) {
      if (res.ok) {
        return res.json().catch(function () {
          return {}
        })
      }
      return res.text().then(function (text) {
        throw { status: res.status, message: text || 'HTTP ' + res.status }
      })
    })
  }

  return {
    start(payload) {
      return request('POST', '/start', payload)
    },
    pause(payload) {
      return request('POST', '/pause', payload)
    },
    stop(payload) {
      return request('POST', '/stop', payload)
    },
    check() {
      return request('GET', '/check')
    },
  }
}
