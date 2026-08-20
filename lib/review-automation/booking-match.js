'use strict';

const { cleanText, normalizeEmail, normalizePhone } = require('./http');

function safeIdentifier(value) {
  return /^[a-z_][a-z0-9_]*$/i.test(String(value || '')) ? String(value) : null;
}

async function findBooking(supabase, contact) {
  const table = safeIdentifier(process.env.REVIEW_BOOKINGS_TABLE);
  if (!table) return null;

  const idColumn = safeIdentifier(process.env.REVIEW_BOOKING_ID_COLUMN || 'id');
  const customerColumn = safeIdentifier(process.env.REVIEW_BOOKING_CUSTOMER_ID_COLUMN || 'customer_id');
  const emailColumn = safeIdentifier(process.env.REVIEW_BOOKING_EMAIL_COLUMN || 'email');
  const phoneColumn = safeIdentifier(process.env.REVIEW_BOOKING_PHONE_COLUMN || 'phone');
  const dateColumn = safeIdentifier(process.env.REVIEW_BOOKING_SERVICE_DATE_COLUMN || 'service_date');
  if (![idColumn, customerColumn, emailColumn, phoneColumn, dateColumn].every(Boolean)) return null;

  const selection = [idColumn, customerColumn, emailColumn, phoneColumn, dateColumn].join(',');
  const email = normalizeEmail(contact.email);
  const phone = cleanText(contact.phone, 50);
  const candidates = [];

  if (contact.bookingId) {
    const { data, error } = await supabase.from(table).select(selection).eq(idColumn, contact.bookingId).limit(2);
    if (!error) candidates.push(...(data || []).map(row => ({ row, confidence: 1 })));
  }
  if (!candidates.length && email) {
    const { data, error } = await supabase.from(table).select(selection).ilike(emailColumn, email).limit(5);
    if (!error) candidates.push(...(data || []).map(row => ({ row, confidence: 0.95 })));
  }
  if (!candidates.length && phone) {
    const { data, error } = await supabase.from(table).select(selection).eq(phoneColumn, phone).limit(5);
    if (!error) candidates.push(...(data || []).map(row => ({ row, confidence: 0.9 })));
  }

  const normalizedContactPhone = normalizePhone(phone);
  const exact = candidates.filter(candidate => {
    const rowEmail = normalizeEmail(candidate.row[emailColumn]);
    const rowPhone = normalizePhone(candidate.row[phoneColumn]);
    return (!email || rowEmail === email) && (!normalizedContactPhone || rowPhone === normalizedContactPhone);
  });
  const chosen = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : null;
  if (!chosen) return null;

  return {
    bookingId: cleanText(chosen.row[idColumn], 200),
    customerId: cleanText(chosen.row[customerColumn], 200),
    serviceDate: cleanText(chosen.row[dateColumn], 40),
    confidence: chosen.confidence
  };
}

module.exports = { findBooking, safeIdentifier };
