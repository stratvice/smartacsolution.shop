/* Shared admin helpers: API calls, toasts, drawers, repeatable field rows. */
(function () {
  'use strict';

  // ------------------------------------------------------------------ toast
  var host = document.createElement('div');
  host.className = 'toast-host';
  document.addEventListener('DOMContentLoaded', function () {
    document.body.appendChild(host);
  });

  function toast(message, kind) {
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity .25s';
      setTimeout(function () { el.remove(); }, 250);
    }, kind === 'err' ? 5200 : 2600);
  }

  // -------------------------------------------------------------------- api
  /**
   * JSON fetch against the admin API.
   * A 401 means the session expired — bounce to login rather than fail quietly.
   */
  function api(method, url, body, isForm) {
    var options = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined && body !== null) {
      if (isForm) {
        options.body = body; // FormData sets its own content-type boundary
      } else {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
    }
    return fetch(url, options).then(function (res) {
      if (res.status === 401) {
        window.location.href = '/admin/login?next=' + encodeURIComponent(window.location.pathname);
        throw new Error('Session expired.');
      }
      if (res.status === 204) return {};
      return res
        .json()
        .catch(function () { return {}; })
        .then(function (data) {
          if (!res.ok) {
            var msg = data.error || 'Request failed (' + res.status + ').';
            if (Array.isArray(data.details) && data.details.length) {
              msg += ' ' + data.details.map(function (d) { return d.field + ': ' + d.message; }).join('; ');
            }
            throw new Error(msg);
          }
          return data;
        });
    });
  }

  // ---------------------------------------------------------------- sidebar
  document.addEventListener('DOMContentLoaded', function () {
    var sidebar = document.querySelector('.sidebar');
    var burger = document.querySelector('.hamburger');
    var backdrop = document.querySelector('.sidebar-backdrop');
    if (burger && sidebar) {
      burger.addEventListener('click', function () {
        sidebar.classList.toggle('open');
        if (backdrop) backdrop.classList.toggle('open', sidebar.classList.contains('open'));
      });
    }
    if (backdrop && sidebar) {
      backdrop.addEventListener('click', function () {
        sidebar.classList.remove('open');
        backdrop.classList.remove('open');
      });
    }

    // Confirm every destructive action, wherever it appears.
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-confirm]');
      if (!el) return;
      if (!window.confirm(el.getAttribute('data-confirm'))) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    // Live preview for any image URL input.
    document.addEventListener('change', function (e) {
      var input = e.target.closest('[data-image-input]');
      if (!input) return;
      var wrap = input.closest('.image-picker');
      var preview = wrap && wrap.querySelector('.preview');
      if (preview) {
        preview.style.backgroundImage = input.value ? "url('" + input.value.replace(/'/g, "\\'") + "')" : '';
        preview.innerHTML = input.value ? '' : '<i class="fa fa-image"></i>';
      }
    });
  });

  // -------------------------------------------------------------- repeaters
  /**
   * Adds/removes/reorders rows in a repeatable field group.
   * Each group carries a <template data-repeat-template> whose __i__ tokens
   * are replaced with the new row index.
   */
  function initRepeaters(root) {
    (root || document).querySelectorAll('[data-repeat]').forEach(function (group) {
      if (group.dataset.repeatReady === '1') return;
      group.dataset.repeatReady = '1';

      var list = group.querySelector('[data-repeat-list]');
      var tpl = group.querySelector('[data-repeat-template]');
      var addBtn = group.querySelector('[data-repeat-add]');

      if (addBtn && tpl && list) {
        addBtn.addEventListener('click', function () {
          var index = list.children.length;
          var html = tpl.innerHTML.replace(/__i__/g, String(index));
          var wrapper = document.createElement('div');
          wrapper.innerHTML = html.trim();
          var node = wrapper.firstElementChild;
          list.appendChild(node);
          renumber(list);
        });
      }

      group.addEventListener('click', function (e) {
        var del = e.target.closest('[data-repeat-remove]');
        if (del) {
          var item = del.closest('.repeat-item');
          if (item && window.confirm('Remove this item?')) {
            item.remove();
            renumber(list);
          }
          return;
        }
        var up = e.target.closest('[data-repeat-up]');
        if (up) {
          var itemU = up.closest('.repeat-item');
          if (itemU && itemU.previousElementSibling) {
            itemU.parentNode.insertBefore(itemU, itemU.previousElementSibling);
            renumber(list);
          }
          return;
        }
        var down = e.target.closest('[data-repeat-down]');
        if (down) {
          var itemD = down.closest('.repeat-item');
          if (itemD && itemD.nextElementSibling) {
            itemD.parentNode.insertBefore(itemD.nextElementSibling, itemD);
            renumber(list);
          }
        }
      });
    });
  }

  /** Keep the visible position labels in step with the DOM order. */
  function renumber(list) {
    if (!list) return;
    Array.prototype.forEach.call(list.children, function (item, i) {
      var label = item.querySelector('[data-repeat-index]');
      if (label) label.textContent = '#' + (i + 1);
    });
  }

  /**
   * Collect a repeat group into an array of plain objects, in DOM order.
   * Inputs are read by their data-key attribute.
   */
  function collectRepeat(group) {
    var out = [];
    var list = group.querySelector('[data-repeat-list]');
    if (!list) return out;
    Array.prototype.forEach.call(list.children, function (item, i) {
      var obj = {};
      item.querySelectorAll('[data-key]').forEach(function (input) {
        var key = input.getAttribute('data-key');
        var value = input.type === 'checkbox' ? input.checked : input.value;
        if (input.dataset.number === '1') value = Number(value) || 0;
        obj[key] = value;
      });
      obj.order = i + 1;
      out.push(obj);
    });
    return out;
  }

  /** Read a whole form's [data-key] inputs into one object. */
  function collectFields(scope) {
    var obj = {};
    scope.querySelectorAll('[data-key]').forEach(function (input) {
      if (input.closest('[data-repeat]')) return; // repeats are handled separately
      var key = input.getAttribute('data-key');
      var value = input.type === 'checkbox' ? input.checked : input.value;
      if (input.dataset.number === '1') value = Number(value) || 0;
      obj[key] = value;
    });
    return obj;
  }

  document.addEventListener('DOMContentLoaded', function () { initRepeaters(document); });

  window.Admin = {
    api: api,
    toast: toast,
    collectRepeat: collectRepeat,
    collectFields: collectFields,
    initRepeaters: initRepeaters,
  };
})();
