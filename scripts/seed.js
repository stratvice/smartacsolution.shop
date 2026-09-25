'use strict';
/**
 * Seeds the database with the exact content that was hard-coded in the
 * original static landing page, so nothing has to be retyped in the admin.
 *
 * Idempotent: safe to re-run. Settings and sections are upserted by key and
 * an already-edited value is never clobbered.
 */
const prisma = require('../src/lib/prisma');
// Site prose lives in db/copy.js so the seed and the live content update
// cannot drift apart.
const COPY = require('../db/copy');

const PHONE = '+91 93688 13078';
const PHONE_RAW = '+919368813078';
const EMAIL = 'smartacsolution.shop@gmail.com';
const COMPANY = 'Smart ac solution Goa';
// Service areas rather than a street address: this is a doorstep service, so
// what a visitor needs to know is whether their area is covered. One per line.
const ADDRESS = 'South Goa\nNorth Goa';

// --------------------------------------------------------------- settings
const SETTINGS = [
  ['company_name', COMPANY, 'general', 'Company name', 'text', 1],
  ['company_name_accent', 'Goa', 'general', 'Brand word shown in accent colour', 'text', 2],
  ['logo_url', '', 'general', 'Logo', 'image', 3],
  ['favicon_url', '', 'general', 'Favicon', 'image', 4],
  ['tagline', 'Your Trusted Repair & Ac Service Experts', 'general', 'Tagline', 'text', 5],

  ['phone', PHONE, 'contact', 'Phone number', 'tel', 1],
  ['whatsapp', PHONE_RAW, 'contact', 'WhatsApp number', 'tel', 2],
  ['email', EMAIL, 'contact', 'Email address', 'email', 3],
  ['address', ADDRESS, 'contact', 'Service areas (one per line)', 'textarea', 4],
  ['short_location', 'Goa', 'contact', 'Short location (top bar)', 'text', 5],
  ['working_hours', 'Mon–Sun: 8AM – 8PM', 'contact', 'Working hours (short)', 'text', 6],
  [
    'working_hours_full',
    'Mon – Sun: 8:00 AM – 8:00 PM',
    'contact',
    'Working hours (full)',
    'textarea',
    7,
  ],
  ['maps_url', '', 'contact', 'Google Maps URL', 'url', 8],

  ['social_facebook', '', 'social', 'Facebook URL', 'url', 1],
  ['social_instagram', '', 'social', 'Instagram URL', 'url', 2],
  ['social_twitter', '', 'social', 'X / Twitter URL', 'url', 3],
  ['social_youtube', '', 'social', 'YouTube URL', 'url', 4],
  ['social_linkedin', '', 'social', 'LinkedIn URL', 'url', 5],

  ['default_city', 'Goa', 'location', 'Default city', 'text', 1],
  ['default_state', 'Goa', 'location', 'Default state', 'text', 2],
  ['default_country', 'India', 'location', 'Default country', 'text', 3],
  [
    'location_personalisation',
    'true',
    'location',
    'Personalise copy with visitor city (true/false)',
    'text',
    4,
  ],

  ['primary_cta_text', 'Book Now', 'cta', 'Primary CTA text', 'text', 1],
  ['primary_cta_link', '#contact', 'cta', 'Primary CTA link', 'text', 2],
  ['secondary_cta_text', 'Chat Now', 'cta', 'Secondary CTA text', 'text', 3],
  ['secondary_cta_link', 'https://wa.link/pbjr74', 'cta', 'Secondary CTA link', 'text', 4],
  ['nav_cta_text', 'Call Now', 'cta', 'Navbar CTA text', 'text', 5],
  ['nav_cta_link', 'tel:' + PHONE_RAW, 'cta', 'Navbar CTA link', 'text', 6],
  ['sticky_cta_text', 'Call Now: ' + PHONE, 'cta', 'Sticky bottom bar text', 'text', 7],
  ['sticky_cta_link', 'tel:' + PHONE_RAW, 'cta', 'Sticky bottom bar link', 'text', 8],
  ['whatsapp_float_text', 'Chat on WhatsApp', 'cta', 'Floating WhatsApp tooltip', 'text', 9],

  [
    'seo_title',
    'Smart ac solution Goa | Home Appliance Repair Experts',
    'seo',
    'Page title',
    'text',
    1,
  ],
  [
    'seo_description',
    COPY.seo.description,
    'seo',
    'Meta description',
    'textarea',
    2,
  ],
  [
    'seo_keywords',
    'AC repair, split AC service, window AC repair, ductless AC repair, appliance repair',
    'seo',
    'Meta keywords',
    'textarea',
    3,
  ],
  [
    'seo_og_title',
    'Smart ac solution Goa | Home Appliance Repair Experts',
    'seo',
    'OG title',
    'text',
    4,
  ],
  [
    'seo_og_description',
    COPY.seo.ogDescription,
    'seo',
    'OG description',
    'textarea',
    5,
  ],
  ['seo_og_image', '/images/abt_rep.webp', 'seo', 'OG image', 'image', 6],
  ['seo_canonical_url', '', 'seo', 'Canonical URL', 'url', 7],
  ['seo_robots', 'index, follow', 'seo', 'Robots directive', 'text', 8],
  ['analytics_ga4_id', '', 'seo', 'Google Analytics 4 measurement ID', 'text', 9],
  ['google_site_verification', '', 'seo', 'Google Search Console verification token', 'text', 10],

  // Lead email notifications. Recipients are deliberately empty by default —
  // addresses are configured in Admin → Settings, never hard-coded here.
  ['lead_email_enabled', 'false', 'notifications', 'Lead email notifications', 'text', 1],
  ['lead_email_recipients', '', 'notifications', 'Notification emails', 'textarea', 2],
];

// --------------------------------------------------------------- sections
const SECTIONS = [
  {
    key: 'topbar',
    label: 'Top Bar',
    order: 1,
    content: { showPhone: true, showEmail: true, showLocation: true, showHours: true },
  },
  {
    key: 'hero',
    label: 'Hero',
    order: 2,
    content: {
      badge: '#1 Appliance Repair in {{city}}',
      badgeIcon: 'fa fa-star',
      heading: 'Your Trusted',
      highlight1: 'Repair',
      connector: '&',
      highlight2: 'Ac Service',
      headingSuffix: 'Experts',
      description: COPY.hero.description,
      imageUrl: '/images/abt_rep.webp',
      imageAlt: 'Smart ac solution Goa',
      primaryBtnText: 'Book Now',
      primaryBtnLink: '#contact',
      primaryBtnIcon: '',
      secondaryBtnText: 'Chat Now',
      secondaryBtnLink: 'https://wa.link/pbjr74',
      secondaryBtnIcon: 'fab fa-whatsapp',
      stats: [
        { value: 9000, label: 'Jobs Done', accent: false },
        { value: 8500, label: 'Happy Customers', accent: true },
        { value: 70, label: 'Expert Staff', accent: false },
      ],
    },
  },
  {
    key: 'ticker',
    label: 'Scrolling Ticker',
    order: 3,
    content: {
      items: [
        { icon: 'fa fa-snowflake', text: 'Split  AC Repair' },
        { icon: 'fa fa-tshirt', text: 'Window  AC Repair' },
        { icon: 'fa fa-blender', text: 'Ductless AC Repair' },
        { icon: 'fa fa-check-circle', text: 'Same Day Service' },
        { icon: 'fa fa-shield-alt', text: 'Genuine Spare Parts' },
        { icon: 'fa fa-star', text: 'Certified Technicians' },
      ],
    },
  },
  {
    key: 'about',
    label: 'Welcome / About',
    order: 4,
    content: {
      badge: 'Who We Are',
      badgeIcon: 'fa fa-tools',
      heading: 'Welcome to',
      highlight: COMPANY,
      headingSuffix: 'Service',
      description: COPY.about.description,
      images: [
        { url: '/images/images.jfif', alt: 'Technician at work' },
        { url: '/images/06b00d1f-11a8-47ac-9a74-12daf4974349_.jpg', alt: 'AC repair' },
        { url: '/images/images1.jfif', alt: 'Washing machine repair' },
      ],
      features: [
        {
          icon: 'fa fa-user-check',
          style: 'icon-orange',
          title: 'Expert Technicians',
          description:
            COPY.about.features[0],
        },
        {
          icon: 'fa fa-clock',
          style: 'icon-teal',
          title: 'Same-Day Service',
          description:
            COPY.about.features[1],
        },
        {
          icon: 'fa fa-rupee-sign',
          style: 'icon-orange',
          title: 'Transparent Pricing',
          description:
            COPY.about.features[2],
        },
      ],
      stats: [
        { value: 9000, label: 'Work Done' },
        { value: 8500, label: 'Clients' },
        { value: 70, label: 'Staff' },
      ],
      buttonText: '',
      buttonLink: '',
    },
  },
  {
    key: 'services_header',
    label: 'Services heading',
    order: 5,
    content: {
      badge: 'What We Fix',
      badgeIcon: 'fa fa-cogs',
      heading: 'Explore Our',
      highlight: 'Services',
    },
  },
  {
    key: 'why',
    label: 'Why Choose Us',
    order: 6,
    content: {
      badge: 'Our Edge',
      badgeIcon: 'fa fa-trophy',
      heading: 'Why Choose',
      highlight: 'GOA',
      headingSuffix: 'Service ?',
      description:
        "We don't just fix machines. We build trust. Our promise is punctuality, precision, and peace of mind for every household in {{state}}.",
      rating: '4.9',
      ratingLabel: 'Average Customer Rating',
      cards: [
        {
          icon: 'fa fa-user-check',
          accent: 'orange',
          title: 'Certified Experts',
          description:
            COPY.why[0],
        },
        {
          icon: 'fa fa-bolt',
          accent: 'teal',
          title: 'Same Day Service',
          description:
            COPY.why[1],
        },
        {
          icon: 'fa fa-shield-alt',
          accent: 'orange',
          title: '90-Day Warranty',
          description:
            COPY.why[2],
        },
        {
          icon: 'fa fa-rupee-sign',
          accent: 'teal',
          title: 'Upfront Pricing',
          description: COPY.why[3],
        },
        {
          icon: 'fa fa-tools',
          accent: 'orange',
          title: 'Genuine Parts Only',
          description:
            COPY.why[4],
        },
        {
          icon: 'fa fa-headset',
          accent: 'teal',
          title: '24/7 Support',
          description: COPY.why[5],
        },
      ],
    },
  },
  {
    key: 'process',
    label: 'How It Works (Steps)',
    order: 7,
    content: {
      badge: 'How It Works',
      badgeIcon: 'fa fa-list-ol',
      heading: '4 Simple',
      highlight: 'Steps',
      headingSuffix: 'to Fix',
      steps: [
        {
          number: '1',
          icon: 'fa fa-phone',
          title: 'Book Service',
          description: 'Call or WhatsApp us with your appliance issue and location.',
          order: 1,
        },
        {
          number: '2',
          icon: 'fa fa-user-check',
          title: 'Expert Arrives',
          description: 'Our certified technician reaches your door on schedule.',
          order: 2,
        },
        {
          number: '3',
          icon: 'fa fa-search',
          title: 'Diagnose & Quote',
          description: 'We inspect and give you a transparent quote upfront.',
          order: 3,
        },
        {
          number: '4',
          icon: 'fa fa-check',
          title: 'Repair & Done',
          description: 'We fix it right, backed by our 90-day warranty guarantee.',
          order: 4,
        },
      ],
    },
  },
  {
    key: 'testimonials_header',
    label: 'Testimonials heading',
    order: 8,
    content: {
      badge: 'Customer Reviews',
      badgeIcon: 'fa fa-star',
      heading: 'What Our',
      highlight: 'Clients',
      headingSuffix: 'Say',
    },
  },
  {
    key: 'faq_header',
    label: 'FAQ heading',
    order: 9,
    content: {
      badge: 'FAQ',
      badgeIcon: 'fa fa-question-circle',
      heading: 'Frequently Asked',
      highlight: 'Questions',
      description:
        "Can't find your answer here? Just WhatsApp or call us directly. We're always happy to help!",
      buttonText: 'Ask on WhatsApp',
      buttonLink: 'https://wa.me/' + PHONE_RAW,
      buttonIcon: 'fab fa-whatsapp',
    },
  },
  {
    key: 'contact',
    label: 'Contact',
    order: 10,
    content: {
      badge: 'Get In Touch',
      badgeIcon: 'fa fa-envelope',
      heading: 'Contact',
      highlight: 'For Any',
      headingSuffix: 'Query',
      cardHeading: "We're Here to",
      cardHighlight: 'Help',
      formButtonText: 'Send Message',
      formButtonIcon: 'fa fa-paper-plane',
      whatsappButtonText: 'Chat with us',
      successMessage: "Thank you! We've received your request and will call you back shortly.",
    },
  },
  {
    key: 'footer',
    label: 'Footer',
    order: 11,
    content: {
      aboutTitle: 'About Us',
      about:
        'One stop solution for all air conditioner repair & service needs in Goa. Certified technicians, genuine parts, fast service.',
      companyLinksTitle: 'Company',
      companyLinks: [
        { text: 'Home', url: '#' },
        { text: 'About Us', url: '#about' },
        { text: 'Services', url: '#services' },
        { text: 'Why Us', url: '#why' },
        { text: 'Contact', url: '#contact' },
      ],
      servicesLinksTitle: 'Services',
      contactTitle: 'Contact',
      hoursTitle: 'Working Hours',
      hoursText: 'Mon–Sun: 8AM – 8PM',
      copyright: '© ' + new Date().getFullYear() + ' ' + COMPANY + '. All Rights Reserved.',
    },
  },
];

// --------------------------------------------------------------- services
const SERVICES = [
  {
    title: 'Split AC Repair',
    slug: 'split-ac-repair',
    badge: 'Most Popular',
    icon: 'fa fa-snowflake',
    iconStyle: '',
    imageUrl: '/images/split-ac-service.webp',
    imageAlt: 'AC Repair',
    description: COPY.services['split-ac-repair'],
    buttonText: 'Call Now',
    buttonLink: 'tel:' + PHONE_RAW,
    buttonIcon: 'fa fa-phone',
    order: 1,
  },
  {
    title: 'Window AC Repair',
    slug: 'window-ac-repair',
    badge: '',
    icon: 'fa fa-tshirt',
    iconStyle: 'background: linear-gradient(135deg, var(--teal), var(--teal-dark))',
    imageUrl: '/images/window-ac-repair.webp',
    imageAlt: 'Window AC Repair',
    description: COPY.services['window-ac-repair'],
    buttonText: 'Call Now',
    buttonLink: 'tel:' + PHONE_RAW,
    buttonIcon: 'fa fa-phone',
    order: 2,
  },
  {
    title: 'Ductless AC Repair',
    slug: 'ductless-ac-repair',
    badge: '',
    icon: 'fa fa-blender',
    iconStyle: '',
    imageUrl: '/images/ductless.webp',
    imageAlt: 'Ductless AC Repair',
    description: COPY.services['ductless-ac-repair'],
    buttonText: 'Call Now',
    buttonLink: 'tel:' + PHONE_RAW,
    buttonIcon: 'fa fa-phone',
    order: 3,
  },
];

// ----------------------------------------------------------- testimonials
const TESTIMONIALS = [
  {
    name: 'Rahul Naik',
    location: 'Smart ac solution Goa, Goa',
    rating: 5,
    order: 1,
    review:
      '"My split AC stopped cooling during peak summer. The technician arrived on time, quickly identified the issue, and fixed it the same day. The service was professional, and the pricing was transparent. Highly recommended!"',
  },
  {
    name: 'Priya Dessai',
    location: 'Panaji, Goa',
    rating: 5,
    order: 2,
    review:
      '"Excellent AC repair service! The technician explained the problem clearly and repaired my inverter AC without unnecessary part replacements. Very satisfied with the quality of work."',
  },
  {
    name: 'Suresh Kamat',
    location: 'Mapusa, Goa',
    rating: 4.5,
    order: 3,
    review:
      '"Booked an AC service online, and the response was very quick. My AC is cooling perfectly now. The technician was polite, experienced, and completed the work neatly."',
  },
  {
    name: 'Anjali Mascarenhas',
    location: 'Vasco, Goa',
    rating: 5,
    order: 4,
    review:
      '"I had water leaking from my split AC. The problem was fixed within an hour, and the technician also cleaned the indoor unit thoroughly. Great experience from start to finish."',
  },
];

// -------------------------------------------------------------------- FAQ
const FAQS = [
  {
    question: 'Do you offer same-day repair service?',
    answer:
      "Yes! Book before 12 noon and we'll have a technician at your door the same day. We understand appliance emergencies can't wait.",
    order: 1,
  },
  {
    question: 'Is there a warranty on repairs?',
    answer:
      'Absolutely! All repairs come with a 90-day service warranty. If the same issue recurs within this period, we fix it free of charge.',
    order: 2,
  },
  {
    question: 'How do I book a service?',
    answer:
      'Simply call us at ' +
      PHONE +
      " or send a WhatsApp message. You can also fill our contact form below and we'll get back to you within 30 minutes.",
    order: 3,
  },
  {
    question: 'Do you use original spare parts?',
    answer:
      'Yes, we use only OEM-approved genuine spare parts for all repairs. This ensures longevity and proper functioning of your appliances after service.',
    order: 4,
  },
  {
    question: 'What areas do you cover in Goa?',
    answer:
      'We cover all major areas in Goa including Panaji, Porvorim, Mapusa, Vasco, Margao, Panjim, Calangute, and surrounding localities.',
    order: 5,
  },
];

// ------------------------------------------------------------------ media
const MEDIA = [
  ['/images/abt_rep.webp', 'abt_rep.webp', 'Technician repairing an air conditioner'],
  ['/images/images.jfif', 'images.jfif', 'Technician at work'],
  ['/images/06b00d1f-11a8-47ac-9a74-12daf4974349_.jpg', '06b00d1f.jpg', 'AC repair'],
  ['/images/images1.jfif', 'images1.jfif', 'Appliance repair'],
  ['/images/split-ac-service.webp', 'split-ac-service.webp', 'Split AC service'],
  ['/images/window-ac-repair.webp', 'window-ac-repair.webp', 'Window AC repair'],
  ['/images/ductless.webp', 'ductless.webp', 'Ductless AC repair'],
];

async function main() {
  console.log('Seeding database…');

  for (const [key, value, group, label, type, order] of SETTINGS) {
    await prisma.siteSetting.upsert({
      where: { key },
      update: { group, label, type, order }, // never clobber an edited value
      create: { key, value, group, label, type, order },
    });
  }
  console.log('  settings:     ' + SETTINGS.length);

  for (const s of SECTIONS) {
    const existing = await prisma.pageSection.findUnique({ where: { key: s.key } });
    if (existing) {
      await prisma.pageSection.update({
        where: { key: s.key },
        data: { label: s.label, order: s.order },
      });
    } else {
      await prisma.pageSection.create({ data: s });
    }
  }
  console.log('  sections:     ' + SECTIONS.length);

  for (const s of SERVICES) {
    await prisma.service.upsert({ where: { slug: s.slug }, update: {}, create: s });
  }
  console.log('  services:     ' + (await prisma.service.count()));

  if ((await prisma.testimonial.count()) === 0) {
    await prisma.testimonial.createMany({ data: TESTIMONIALS });
  }
  console.log('  testimonials: ' + (await prisma.testimonial.count()));

  if ((await prisma.faq.count()) === 0) {
    await prisma.faq.createMany({ data: FAQS });
  }
  console.log('  faqs:         ' + (await prisma.faq.count()));

  for (const [url, filename, alt] of MEDIA) {
    const exists = await prisma.media.findFirst({ where: { url } });
    if (!exists) {
      await prisma.media.create({
        data: { url, filename, alt, provider: 'local', publicId: null, mimeType: null },
      });
    }
  }
  console.log('  media:        ' + (await prisma.media.count()));

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
