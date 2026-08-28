# Review feedback automation (backend only)

The Hobby deployment exposes one multiplexed function to stay below Vercel's function-count limit:

- `POST /api/review-automation?action=form-response`
- `GET /api/review-automation?action=admin-list`
- `POST /api/review-automation?action=admin-action`
- `POST /api/review-automation?action=coupon-validate`
- `POST /api/review-automation?action=coupon-apply`
- `POST /api/review-automation?action=coupon-release`
- `GET /api/review-automation?action=share-feedback&id=...&expires=...&signature=...`
- `GET /api/review-automation?action=track-share-click&id=...&platform=...&expires=...&signature=...`
- `GET|POST /api/review-automation?action=google-sync`

Run `supabase/review_automation.sql` once before using the routes. All review tables have RLS enabled, no `anon` or `authenticated` privileges, and explicit `service_role` grants.

Required server variables:

- `REVIEW_FORM_WEBHOOK_SECRET`
- `REVIEW_ADMIN_API_KEY`
- `REVIEW_ALLOWED_ORIGINS` before frontend integration
- existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `STRIPE_SECRET_KEY`

Safe defaults require no additional variables:

- `PUBLIC_REVIEW_REQUEST_MODE=disabled`
- `REVIEW_INTERNAL_FEEDBACK_COUPON_MODE=manual`
- `REVIEW_INTERNAL_FEEDBACK_MIN_RATING=5` (legacy setting; coupon eligibility is enforced as exactly 5/5 in the handler)
- `REVIEW_COUPON_TTL_DAYS=90`
- `REVIEW_COUPON_RESERVATION_MINUTES=20`
- `REVIEW_FEEDBACK_SHARE_MODE=disabled`
- `REVIEW_SHARE_LINK_TTL_DAYS=30`

Set `REVIEW_FEEDBACK_SHARE_MODE=all_respondents` to send the same neutral sharing option to every new respondent with an email address. It is delivered as a separate branded email after any coupon email, so the coupon message remains focused only on redemption. The signed page displays only that respondent's private comment and lets the customer copy/edit it before personally opening Google. Yelp is presented as a neutral “Find us on Yelp” link. Opening either destination records one analytics event per respondent and platform in `review_automation_events`; it never generates, sends, or changes a coupon. Optional overrides are `REVIEW_PUBLIC_BASE_URL`, `GOOGLE_REVIEW_URL`, and `YELP_BUSINESS_URL`.

Public reviews never unlock a coupon. Only an exact 5/5 private survey rating can generate a new coupon. New private-feedback coupons are fixed at $25. Previously sent $40 coupons retain their original value and remain redeemable. Google review observation remains disabled until Business Profile OAuth values are configured.

Automatic coupon delivery uses the same visual system as the Gift Card email: the Heidi's blue brand header, a responsive card, a prominent coupon value and selectable code, expiration date, scheduling contacts, and a plain-text fallback. The existing Gift Card header asset is attached inline; a text-based branded header is used if the asset cannot be loaded.

The separate feedback-sharing email reuses the same header asset, colors, typography, responsive card, prominent customer greeting, and fallback header. Its button opens the signed private-feedback page, where the respondent can edit or copy their comment before independently choosing Google or Yelp.

The existing Stripe webhook processes review-coupon metadata on `payment_intent.succeeded`. Subscribe it to `payment_intent.canceled` as well before checkout integration so abandoned/canceled reservations can be released immediately; the reservation TTL remains a fallback.
