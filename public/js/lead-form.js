/**
 * Contact form -> POST /api/leads.
 * Client-side validation mirrors the server rules; the server remains the
 * authority. Preserves the original button feedback animation.
 */
(function () {
  'use strict';

  var form = document.getElementById('leadForm');
  if (!form) return;

  var msgBox = document.getElementById('leadFormMsg');
  var button = form.querySelector('.btn-submit');
  var originalHtml = button ? button.innerHTML : '';
  var submitting = false;

  function setMessage(text, kind) {
    if (!msgBox) return;
    msgBox.textContent = text || '';
    msgBox.style.cssText = text
      ? 'font-size:0.9rem;font-weight:600;padding:12px 14px;border-radius:10px;' +
        (kind === 'error'
          ? 'color:#b42318;background:rgba(180,35,24,0.08);border:1px solid rgba(180,35,24,0.25);'
          : 'color:#067647;background:rgba(37,211,102,0.10);border:1px solid rgba(37,211,102,0.35);')
      : '';
  }

  function clearFieldErrors() {
    form.querySelectorAll('.is-invalid').forEach(function (el) {
      el.classList.remove('is-invalid');
    });
    form.querySelectorAll('.invalid-feedback').forEach(function (el) {
      el.textContent = '';
      el.style.display = 'none';
    });
  }

  function showFieldError(name, message) {
    var field = form.querySelector('[name="' + name + '"]');
    if (!field) return false;
    field.classList.add('is-invalid');
    // Inputs sit inside a .field wrapper (for the icon and the Detect
    // button), so the message element is a sibling of that wrapper rather
    // than of the input itself.
    var wrap = field.closest('.field');
    var group = wrap ? wrap.parentElement : field.parentElement;
    var fb = group && group.querySelector('.invalid-feedback');
    if (fb) {
      fb.textContent = message;
      fb.style.cssText = 'display:block;color:#b42318;font-size:0.8rem;margin-top:4px;';
    }
    return true;
  }

  /** Mirrors the zod rules on the server. */
  function validate(data) {
    var errors = [];
    if (!data.name || data.name.trim().length < 2) {
      errors.push(['name', 'Please enter your name.']);
    }
    if (!data.phone || !/^[+\d][\d\s\-().]{6,}$/.test(data.phone.trim())) {
      errors.push(['phone', 'Please enter a valid phone number.']);
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim())) {
      errors.push(['email', 'Please enter a valid email.']);
    }
    return errors;
  }

  /** The enquiry, formatted for a phone screen rather than an inbox. */
  function whatsappText(data) {
    var lines = ['New service request', ''];
    var add = function (label, value) {
      if (value) lines.push(label + ' - ' + value);
    };

    add('Name', data.name);
    add('Number', data.phone);
    add('Mail', data.email);

    // A map pin only exists if the visitor granted location or pressed Detect.
    if (data.latitude && data.longitude) {
      add('Location link', 'https://maps.google.com/?q=' + data.latitude + ',' + data.longitude);
    }
    // Detect writes "Panaji, Goa" into the area field while city and state
    // hold the same two words, so compare the parts rather than the strings
    // or the line comes out as "Panaji, Goa, Panaji, Goa".
    var place = [];
    String(data.area || '')
      .split(',')
      .concat([data.city, data.state])
      .forEach(function (part) {
        var value = String(part || '').trim();
        if (!value) return;
        var seen = place.some(function (kept) {
          return kept.toLowerCase() === value.toLowerCase();
        });
        if (!seen) place.push(value);
      });
    add('Location', place.join(', '));

    add('Service', data.service);
    add('Message', data.message);

    return lines.join('\n');
  }

  /**
   * Hand the enquiry to WhatsApp once it is safely saved.
   *
   * This opens the visitor's own WhatsApp with the message written out and
   * addressed to the business; they still press send. Sending on their behalf
   * would need a WhatsApp Business API account, so this cannot be relied on as
   * the notification -- it is a shortcut, and the lead is already in the
   * database either way.
   */
  function handOffToWhatsApp(data) {
    var number = (form.getAttribute('data-wa-number') || '').replace(/\D/g, '');
    if (!number) return;

    var url = 'https://wa.me/' + number + '?text=' + encodeURIComponent(whatsappText(data));

    // Offer the link as well as opening it: a pop-up blocker can stop the
    // call below, and the visitor may want it on a different device.
    if (msgBox) {
      var link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Open WhatsApp';
      link.style.cssText = 'display:inline-block;margin-top:10px;font-weight:700;color:#067647;text-decoration:underline;';
      msgBox.appendChild(document.createElement('br'));
      msgBox.appendChild(link);
    }

    setTimeout(function () {
      var opened = window.open(url, '_blank');
      if (!opened) window.location.href = url; // pop-up blocked
    }, 1500);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (submitting) return;

    clearFieldErrors();
    setMessage('');

    var fd = new FormData(form);
    var data = {};
    fd.forEach(function (value, key) {
      data[key] = typeof value === 'string' ? value.trim() : value;
    });
    data.pageUrl = window.location.href;

    // Attach whatever the geolocation script resolved, if anything.
    var loc = window.__visitorLocation;
    if (loc) {
      if (!data.city) data.city = loc.city || '';
      if (!data.state) data.state = loc.state || '';
      if (!data.country) data.country = loc.country || '';
      if (!data.locationSrc) data.locationSrc = loc.source || '';
      if (!data.latitude && loc.latitude != null) data.latitude = loc.latitude;
      if (!data.longitude && loc.longitude != null) data.longitude = loc.longitude;
    }
    // Empty strings would fail the numeric coercion server-side.
    if (!data.latitude) delete data.latitude;
    if (!data.longitude) delete data.longitude;
    if (!data.locationSrc) delete data.locationSrc;

    var errors = validate(data);
    if (errors.length) {
      errors.forEach(function (pair) {
        showFieldError(pair[0], pair[1]);
      });
      setMessage('Please correct the highlighted fields.', 'error');
      return;
    }

    submitting = true;
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i class="fa fa-circle-notch fa-spin me-2"></i>Sending…';
    }

    fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(data),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (result) {
        if (result.ok) {
          form.reset();
          clearFieldErrors();
          setMessage(
            result.body.message || "Thank you! We've received your request and will call you back shortly.",
            'success'
          );
          handOffToWhatsApp(data);
          if (button) {
            button.innerHTML = '<i class="fa fa-check me-2"></i>Message Sent!';
            button.style.background = '#25D366';
            setTimeout(function () {
              button.innerHTML = originalHtml;
              button.style.background = '';
            }, 3000);
          }
          return;
        }

        // Field-level errors from the server land on the right inputs.
        var handled = false;
        if (result.body && Array.isArray(result.body.details)) {
          result.body.details.forEach(function (d) {
            if (showFieldError(d.field, d.message)) handled = true;
          });
        }
        setMessage(
          handled
            ? 'Please correct the highlighted fields.'
            : result.body && result.body.error
              ? result.body.error
              : 'Could not send your message. Please call us instead.',
          'error'
        );
      })
      .catch(function () {
        setMessage('Network error. Please check your connection or call us directly.', 'error');
      })
      .finally(function () {
        submitting = false;
        if (button) {
          button.disabled = false;
          if (button.innerHTML.indexOf('fa-spin') !== -1) button.innerHTML = originalHtml;
        }
      });
  });
})();
