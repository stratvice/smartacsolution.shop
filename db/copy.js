'use strict';
/**
 * Site prose, in one place.
 *
 * Both scripts/seed.js (fresh installs) and scripts/apply-content-update.js
 * (existing databases) read from here, so the two cannot drift apart.
 *
 * The copy is deliberately specific to air conditioning in Goa rather than
 * generic appliance-repair filler. Salt-laden coastal air, a four-month
 * monsoon and year-round humidity genuinely do wear units out faster here —
 * saying so is both true and the thing no competitor's template says.
 */

module.exports = {
  hero: {
    description:
      'Coastal salt air and monsoon humidity are hard on air conditioners. We repair and service every major brand across North and South Goa. Same day, at your door.',
  },

  about: {
    description:
      'Air conditioners work harder in Goa than almost anywhere else. Salt carried in off the Arabian Sea eats into condenser coils, and months of humidity clog drain lines and leave blower wheels damp enough to smell. A unit that would run quietly for years inland can start losing its cooling here in a couple of seasons. We repair and maintain them across North and South Goa. Split, window and cassette, every major brand, with a price agreed before we start and ninety days of warranty on the work.',
    features: [
      'Trained on split, window and cassette systems, and background-verified before they set foot in your home.',
      'Call before noon and we aim to reach you the same day. In peak summer, no-cooling calls go to the front of the queue.',
      'You get the price before the work starts, not after. No call-out surprises and no padded parts bill.',
    ],
  },

  // Each service reads differently because the faults genuinely differ.
  services: {
    'split-ac-repair':
      'Weak cooling, water dripping from the indoor unit, or a blower that has started to smell. These are the calls we take most. In Goa the cause is usually humidity, meaning a blocked drain line or mould in the blower wheel, or gas lost through coils the sea air has corroded. We find out which before we touch anything, rather than topping up refrigerant and leaving you to call again in three months.',
    'window-ac-repair':
      'Window units sit half outside, so Goa weathers them quickly: fan bearings that rattle, a compressor that trips the moment it starts, drain trays rusted through. We carry the common spares with us and repair on the spot wherever it makes sense. Where a unit is genuinely past saving, we will tell you that instead of selling you a repair that buys a few weeks.',
    'ductless-ac-repair':
      'Cassette and multi-split systems in shops, restaurants, clinics and larger homes. These are the units that cannot be out of action for long. We diagnose on site, clean filters and coils properly rather than superficially, handle refrigerant and control-board work, and schedule servicing around your opening hours instead of ours.',
  },

  // Section intros. These two sit above the card grids rather than in them,
  // so apply-content-update.js has to set them explicitly.
  intros: {
    why: "We don't just fix machines. We build trust. Our promise is punctuality, precision, and peace of mind for every household in {{state}}.",
    faq: "Can't find your answer here? Just WhatsApp or call us directly. We're always happy to help!",
  },

  why: [
    'Every technician is trained and background-verified, and works on air conditioning specifically, not whatever appliance turned up that week.',
    'Book before noon and we aim to be with you the same day, anywhere in North or South Goa.',
    'Ninety days of warranty on every repair. If the same fault returns in that time, we come back and fix it at no cost.',
    'The price is agreed before the work starts. What we quote is what you pay, including parts.',
    'OEM-approved spares only. Cheap replacement parts fail fastest in salt air, which makes them the expensive option.',
    'Call or WhatsApp whenever something goes wrong, including evenings and Sundays, when most AC failures actually happen.',
  ],

  // Every job the business actually takes. These drive the keyword list and
  // the Service entries in the structured data, so a search engine can match
  // "AC gas charging" even though the page only shows three service cards.
  servicesOffered: [
    'AC Service',
    'AC Repair',
    'AC Installation',
    'AC Uninstallation',
    'AC Gas Charging',
    'AC Gas Leak Repair',
    'AC Water Leakage',
    'AC PCB Repair',
    'AC Compressor Repair',
    'AC Deep Cleaning',
    'AC Maintenance',
  ],

  // Towns across both districts, for areaServed. This is the field that
  // decides which "AC repair near me" searches the business is a candidate
  // for, so it is worth listing properly rather than only "Goa".
  serviceAreas: [
    // North Goa
    'Panaji', 'Mapusa', 'Porvorim', 'Calangute', 'Candolim', 'Anjuna', 'Baga',
    'Siolim', 'Assagao', 'Arpora', 'Bicholim', 'Sanquelim', 'Valpoi', 'Pernem',
    'Dona Paula', 'Taleigao', 'Ponda',
    // South Goa
    'Margao', 'Vasco da Gama', 'Mormugao', 'Colva', 'Benaulim', 'Verna',
    'Cortalim', 'Quepem', 'Curchorem', 'Canacona', 'Sanguem',
  ],

  seo: {
    // Built from the two lists above so they can never drift: every service,
    // then the town phrases people actually type. Google has ignored the
    // keywords meta tag since 2009 -- this is here because it was asked for
    // and some smaller engines and site searches still read it. The work that
    // moves rankings is servicesOffered and serviceAreas reaching the
    // structured data, and the page title below.
    keywords: null, // filled in after the module is built

    description:
      'AC repair and service across North and South Goa. Split, window and cassette systems, every major brand. Same-day visits, genuine parts, 90-day warranty on all work.',
    ogDescription:
      'AC repair and service across North and South Goa. Same-day visits, genuine parts, and ninety days of warranty on every repair.',
  },
};

// Keywords are derived rather than typed out, so adding a town or a service
// above is the only edit ever needed.
module.exports.seo.keywords = []
  .concat(module.exports.servicesOffered)
  .concat(module.exports.serviceAreas.map(function (town) { return 'AC Repair in ' + town; }))
  .concat(['AC repair Goa', 'AC service Goa', 'AC technician near me', 'split AC repair', 'window AC repair'])
  .join(', ');
