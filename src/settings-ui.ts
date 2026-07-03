// Settings screen (Lampa.SettingsApi) + token validation.

import { DEFAULT_BASE_URL, DEFAULT_THRESHOLD, PLUGIN_ID, STORAGE } from './config'
import type { ConnectionStatus, ScrobbleClient, SettingsReader } from './types'

const ICON =
  '<svg viewBox="0 0 149 152" width="24" height="24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M28.5832 152C12.4727 152 0 139.166 0 123.765V78.0767C0 62.1626 12.9924 49.8421 28.5832 49.8421H119.53C135.64 49.8421 148.113 62.676 148.113 78.0767V123.765C148.113 139.68 135.121 152 119.53 152H28.5832ZM16.1106 83.2103V118.632C16.1106 127.359 23.3863 134.546 32.2211 134.546H115.372C124.207 134.546 131.483 127.359 131.483 118.632V83.2103C131.483 74.4832 124.207 67.2962 115.372 67.2962H32.2211C23.3863 67.2962 16.1106 74.4832 16.1106 83.2103Z"/><path fill="currentColor" d="M73.7954 24.6876C62.3621 24.6876 53.5273 33.4146 53.0076 44.1951H94.5832C94.0635 33.4146 85.2286 24.6876 73.7954 24.6876Z"/><path fill="currentColor" d="M56.1264 33.4142L31.7008 9.28645C30.6614 8.25974 30.6614 7.23302 31.7008 6.20631C32.7402 5.17959 33.7795 5.17959 34.8189 6.20631L59.2446 30.3341C60.284 31.3608 60.284 32.3875 59.2446 33.4142C58.7249 33.9276 57.1658 33.9276 56.1264 33.4142Z"/><path fill="currentColor" d="M36.422 10.5162C38.8574 8.11045 38.8574 4.21 36.422 1.80429C33.9865 -0.601431 30.038 -0.601428 27.6025 1.80429C25.1671 4.21001 25.1671 8.11045 27.6025 10.5162C30.038 12.9219 33.9865 12.9219 36.422 10.5162Z"/><path fill="currentColor" d="M88.3502 29.8209L112.776 5.69313C113.815 4.66642 114.855 4.66642 115.894 5.69313C116.934 6.71984 116.934 7.74656 115.894 8.77327L91.4684 32.9011C90.429 33.9278 89.3896 33.9278 88.3502 32.9011C87.3109 32.3877 87.3109 30.8476 88.3502 29.8209Z"/><path fill="currentColor" d="M119.134 10.7008C121.566 8.29166 121.56 4.3912 119.121 1.98888C116.683 -0.413431 112.734 -0.407898 110.302 2.00122C107.87 4.41034 107.876 8.31077 110.315 10.7131C112.753 13.1154 116.702 13.1099 119.134 10.7008Z"/></svg>'

// Map the stored connection status to a short coloured label for the UI.
export function statusLabel(code: ConnectionStatus | string): string {
  switch (code) {
    case 'ok':
      return '<span style="color:#16a34a">● Подключено</span>'
    case 'invalid':
      return '<span style="color:#dc2626">● Токен недействителен</span>'
    case 'error':
      return '<span style="color:#d97706">● Нет связи с MyShows</span>'
    default:
      return '<span style="color:#76767e">○ Не проверено</span>'
  }
}

export interface SettingsUiDeps {
  settings: SettingsReader
  client: ScrobbleClient
}

export function createSettingsUi(deps: SettingsUiDeps) {
  const { settings, client } = deps

  // Live handle to the settings "Состояние" row, captured in its onRender.
  // Lampa renders `type:'static'` params WITHOUT a data-name attribute, so we
  // keep the element itself and patch it in place rather than re-query the DOM.
  let statusRow: any = null

  function refreshStatusRow(code: ConnectionStatus | string): void {
    if (!statusRow) return
    try {
      statusRow.find('.settings-param__descr').html(statusLabel(code))
    } catch {
      /* noop */
    }
  }

  // Validate the token via GET /check and update status.
  // notify=true also shows a toast (used from the token field onChange).
  function checkToken(notify: boolean): void {
    if (!settings.token) {
      if (notify) Lampa.Noty.show('MyShows: токен не задан')
      return
    }
    if (notify) Lampa.Noty.show('MyShows: проверяем…')
    client.check().then(
      function () {
        settings.setStatus('ok')
        if (notify) Lampa.Noty.show('MyShows: токен работает ✓')
      },
      function (err: any) {
        const bad = err && (err.status === 401 || err.status === 403)
        settings.setStatus(bad ? 'invalid' : 'error')
        if (notify) {
          Lampa.Noty.show(
            'MyShows: ошибка — ' +
              (bad ? 'токен недействителен' : (err && err.message) || 'нет связи'),
          )
        }
      },
    )
  }

  function register(): void {
    Lampa.SettingsApi.addComponent({ component: PLUGIN_ID, name: 'MyShows', icon: ICON })

    // Connection status row (read-only). Reflects the last GET /check or
    // scrobble result; refreshed live via the Storage listener in start().
    Lampa.SettingsApi.addParam({
      component: PLUGIN_ID,
      param: { name: 'myshows_status_view', type: 'static' },
      field: { name: 'Состояние', description: statusLabel(Lampa.Storage.get(STORAGE.status, '')) },
      // Capture the rendered row and sync it to the current status every time
      // the settings screen opens (the description string above is only the
      // initial value captured at registration time).
      onRender: function (item: any) {
        statusRow = item
        refreshStatusRow(Lampa.Storage.get(STORAGE.status, ''))
      },
    })

    Lampa.SettingsApi.addParam({
      component: PLUGIN_ID,
      param: { name: STORAGE.enabled, type: 'trigger', default: true },
      field: { name: 'Скробблинг', description: 'Отправлять прогресс просмотра в MyShows' },
    })

    Lampa.SettingsApi.addParam({
      component: PLUGIN_ID,
      // Two Lampa input-param quirks:
      //  - `values: ''` is needed: Lampa stores values[name] = param.values and
      //    renders `typeof values[name] == 'string' ? ... : values[name][key]`.
      //    Without it values[name] is undefined and it crashes on "reading ''".
      //  - `placeholder` must be set: the template inserts `param.placeholder`
      //    verbatim, so omitting it renders the literal string "undefined".
      param: {
        name: STORAGE.token,
        type: 'input',
        default: '',
        values: '',
        placeholder: 'Вставьте токен из профиля MyShows',
      },
      field: {
        name: 'Токен MyShows',
        description: 'Bearer-токен из профиля MyShows (проверяется при вводе)',
      },
      // Auto-check the token whenever it changes.
      onChange: function () {
        checkToken(true)
      },
    })

    Lampa.SettingsApi.addParam({
      component: PLUGIN_ID,
      param: {
        name: STORAGE.threshold,
        type: 'select',
        values: { 50: '50%', 60: '60%', 70: '70%', 80: '80%', 90: '90%', 95: '95%' },
        default: String(DEFAULT_THRESHOLD),
      },
      field: { name: 'Порог «просмотрено»', description: 'С какого % засчитывать просмотр' },
    })

    Lampa.SettingsApi.addParam({
      component: PLUGIN_ID,
      param: { name: STORAGE.notify, type: 'trigger', default: false },
      field: {
        name: 'Уведомления об ошибках',
        description: 'Показывать ошибки скробблинга на экране',
      },
    })

    Lampa.SettingsApi.addParam({
      component: PLUGIN_ID,
      param: {
        name: STORAGE.baseUrl,
        type: 'input',
        default: DEFAULT_BASE_URL,
        values: '',
        placeholder: DEFAULT_BASE_URL,
      },
      field: { name: 'Адрес API', description: 'Базовый URL scrobble API (для тестов/self-host)' },
    })
  }

  return { register, checkToken, refreshStatusRow }
}
