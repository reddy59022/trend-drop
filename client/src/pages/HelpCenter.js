import React from 'react';
import { Link } from 'react-router-dom';
import {
  FaBook, FaEnvelope, FaShieldAlt, FaShippingFast, FaStore, FaUndoAlt, FaUserCog,
} from 'react-icons/fa';
import { CONTACT_EMAIL, contactMailto } from '../utils/contact';

const QUICK_LINKS = [
  {
    to: '/settings',
    icon: FaUserCog,
    label: 'Account settings',
    detail: 'Profile, email verification, password, and store details.',
  },
  {
    to: '/transactions',
    icon: FaShippingFast,
    label: 'Orders and sales',
    detail: 'Track purchases, sales, delivery, and escrow status.',
  },
  {
    to: '/returns',
    icon: FaUndoAlt,
    label: 'Returns and refunds',
    detail: 'Start a return or follow an open request.',
  },
  {
    to: '/seller-dashboard',
    icon: FaStore,
    label: 'Selling and payouts',
    detail: 'Listings, fees, and when payouts become available.',
  },
  {
    to: '/legal/buyer',
    icon: FaShieldAlt,
    label: 'Buyer rules and delivery',
    detail: 'Inspection windows, delivery, and refund rules.',
  },
  {
    to: '/legal',
    icon: FaBook,
    label: 'Legal center',
    detail: 'Terms, privacy, cookies, seller rules, and prohibited items.',
  },
];

const SUPPORT_SUBJECT = 'TrendDrop help request';

const FAQS = [
  {
    question: 'How do I verify my email address?',
    answer: (
      <>
        Open <Link to="/settings">Account settings</Link> and resend the verification email. The link in
        that message expires after 24 hours. Check your spam folder before requesting another one.
      </>
    ),
  },
  {
    question: 'My order has not arrived.',
    answer: (
      <>
        Open <Link to="/transactions">Orders and sales</Link> to see the carrier tracking for the order.
        If tracking has not updated for several days, or the carrier shows delivered but nothing arrived,
        email <a href={contactMailto('TrendDrop delivery problem')}>support</a> with the order number so a
        carrier trace can be opened.
      </>
    ),
  },
  {
    question: 'How do I return an item?',
    answer: (
      <>
        Start from <Link to="/returns">Returns and refunds</Link>. If a return is rejected and the item was
        materially misdescribed, open a dispute from the order; the other party has 48 hours to respond.
      </>
    ),
  },
  {
    question: 'When do sellers get paid?',
    answer: (
      <>
        Payouts follow the schedule shown in <Link to="/seller-dashboard">Selling and payouts</Link> and are
        sent through Stripe Connect. Funds stay pending while a return or dispute window is open.
      </>
    ),
  },
  {
    question: 'How do I report a listing or a safety issue?',
    answer: (
      <>
        Email <a href={contactMailto('TrendDrop report a listing')}>support</a> with the listing link.
        Counterfeits, stolen goods, and unsafe products are reviewed first.
      </>
    ),
  },
  {
    question: 'How do I exercise a privacy right?',
    answer: (
      <>
        Email <a href={contactMailto('TrendDrop privacy request')}>support</a> with your country and the
        right you want to exercise. The <Link to="/legal/privacy">Privacy Notice</Link> explains what can be
        deleted and what must be retained.
      </>
    ),
  },
];

export default function HelpCenter() {
  return (
    <div className="page-container" style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 className="page-title">Help Center</h1>
      <p style={{ color: 'var(--td-text-secondary)', maxWidth: 640, lineHeight: 1.6 }}>
        Answers to common questions about buying, selling, and shipping on TrendDrop. A person reads every
        message sent to support, so email us if the answer is not here.
      </p>

      <div
        className="glass-card"
        style={{
          padding: 24,
          marginTop: 24,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 240 }}>
          <span
            aria-hidden="true"
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'var(--td-glass-bg)',
              color: 'var(--td-primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            <FaEnvelope />
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Email TrendDrop support</div>
            <a href={contactMailto(SUPPORT_SUBJECT)} style={{ fontSize: 14 }}>{CONTACT_EMAIL}</a>
            <div style={{ fontSize: 13, color: 'var(--td-text-tertiary)' }}>
              Replies come from this address, usually within one business day.
            </div>
          </div>
        </div>
        <a href={contactMailto(SUPPORT_SUBJECT)} className="btn btn-primary">Email support</a>
      </div>

      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '32px 0 12px' }}>Quick links</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 12,
        }}
      >
        {QUICK_LINKS.map(({ to, icon: Icon, label, detail }) => (
          <Link key={`${to}-${label}`} to={to} className="glass-card" style={{ padding: 16, display: 'block' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, marginBottom: 6 }}>
              <Icon aria-hidden="true" style={{ color: 'var(--td-primary)' }} /> {label}
            </div>
            <div style={{ fontSize: 13, color: 'var(--td-text-tertiary)', lineHeight: 1.5 }}>{detail}</div>
          </Link>
        ))}
      </div>

      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '32px 0 12px' }}>Common questions</h2>
      <div style={{ display: 'grid', gap: 10 }}>
        {FAQS.map(({ question, answer }) => (
          <details key={question} className="glass-card" style={{ padding: 16 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 15 }}>{question}</summary>
            <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, color: 'var(--td-text-secondary)' }}>
              {answer}
            </p>
          </details>
        ))}
      </div>

      <p style={{ marginTop: 28, fontSize: 13, color: 'var(--td-text-tertiary)', lineHeight: 1.6 }}>
        Legal notices and privacy requests go to the same address:{' '}
        <a href={contactMailto('TrendDrop legal or privacy request')}>{CONTACT_EMAIL}</a>.
      </p>
    </div>
  );
}
