# Review feedback automation (backend only)

The production backend exposes these additive routes:

- `POST /api/review-form-response`
- `GET /api/review-admin-list`
- `POST /api/review-admin-action`
- `POST /api/review-coupon-validate`
- `POST /api/review-coupon-apply`
- `POST /api/review-coupon-release`
- `GET|POST /api/google-review-sync`

Run `supabase/review_automation.sql` once before using the routes. All review tables have RLS enabled, no `anon` or `authenticated` privileges, and explicit `service_role` grants.

Required server variables:

- `REVIEW_FORM_WEBHOOK_SECRET`
- `REVIEW_ADMIN_API_KEY`
- `REVIEW_ALLOWED_ORIGINS` before frontend integration
- existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `STRIPE_SECRET_KEY`

Safe defaults require no additional variables:

- `PUBLIC_REVIEW_REQUEST_MODE=disabled`
- `REVIEW_INTERNAL_FEEDBACK_COUPON_MODE=manual`
- `REVIEW_INTERNAL_FEEDBACK_MIN_RATING=1`
- `REVIEW_COUPON_TTL_DAYS=90`
- `REVIEW_COUPON_RESERVATION_MINUTES=20`

Public reviews never unlock a coupon. The fixed $40 benefit is attached to the private feedback event. Google review observation remains disabled until Business Profile OAuth values are configured. Coupon emails are only sent when an authenticated administrator explicitly sends them.

The existing Stripe webhook processes review-coupon metadata on `payment_intent.succeeded`. Subscribe it to `payment_intent.canceled` as well before checkout integration so abandoned/canceled reservations can be released immediately; the reservation TTL remains a fallback.
