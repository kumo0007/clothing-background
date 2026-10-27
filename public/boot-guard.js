/**
 * Classic script (not type=module). Runs even when Vite ES modules fail —
 * e.g. Firefox on a phone opening the Astrill VPN IP printed by `vite --host`.
 */
(function () {
  var PRODUCTION = 'https://garment-background-studio.vercel.app/'
  var host = location.hostname || ''
  var search = location.search || ''
  var hash = location.hash || ''

  function isVpnTunnel() {
    var m = /^(\d{1,3})\.(\d{1,3})\./.exec(host)
    if (!m) return false
    var a = +m[1]
    var b = +m[2]
    return a === 198 && (b === 18 || b === 19)
  }

  function allowDev() {
    return /(?:^|[?&])dev=1(?:&|$)/.test(search)
  }

  function productionUrl() {
    if (!hash || hash === '#') return PRODUCTION
    return PRODUCTION + (hash.charAt(0) === '#' ? hash : '#' + hash)
  }

  // Astrill / VPN Vite URL: HTML may load, modules usually do not on phones.
  if (isVpnTunnel() && !allowDev()) {
    location.replace(productionUrl())
    return
  }

  function enhanceFallback(reason) {
    var el = document.getElementById('boot-static-fallback')
    if (!el || el.getAttribute('data-boot-guard') === '1') return
    el.setAttribute('data-boot-guard', '1')
    el.setAttribute('role', 'alert')
    var h1 = el.querySelector('h1')
    if (h1) h1.textContent = 'Could not start Garment Background Studio'
    var actions = document.createElement('p')
    actions.className = 'app-boot-error__actions'
    var link = document.createElement('a')
    link.href = productionUrl()
    link.textContent = 'Open the published app'
    link.setAttribute('data-testid', 'boot-open-production')
    actions.appendChild(link)
    var detail = document.createElement('p')
    detail.className = 'app-boot-error__detail'
    detail.textContent =
      reason +
      ' Current page: ' +
      location.href +
      ' — use the published HTTPS URL on Firefox, not a computer VPN/LAN IP.'
    el.appendChild(detail)
    el.appendChild(actions)
  }

  // If the module entry never replaces #root, surface a clear exit.
  setTimeout(function () {
    if (document.getElementById('boot-static-fallback')) {
      enhanceFallback('App scripts did not load in time.')
    }
  }, 4000)
})()
