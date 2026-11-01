/**
 * OTP Shield — client controller.
 *
 * The browser never decides whether a verification succeeded. It sends input to
 * the server, renders exactly what the server reports, and treats every error
 * (including network failures) as "not verified".
 */
import {
  $,
  $$,
  flagEmoji,
  focusElement,
  formatClock,
  formatCountdown,
  formatDateTime,
  h,
  pluralise,
  setHidden,
} from './dom.js';
import { ApiClient, ApiError } from './api.js';
import { ToastManager } from './toast.js';
import { OtpInput } from './otp-input.js';
import { CountryPicker } from './country-picker.js';

const STEPS = ['phone', 'code', 'verified'];
const PROVIDER_LABEL = 'Twilio Verify';

const api = new ApiClient({ timeoutMs: 20_000 });
const toasts = new ToastManager($('#toasts'));

const els = {
  pill: $('#session-pill'),
  pillLabel: $('#session-pill-label'),
  themeToggle: $('#theme-toggle'),
  configBanner: $('#config-banner'),
  configBannerText: $('#config-banner-text'),
  offlineBanner: $('#offline-banner'),
  offlineBannerText: $('#offline-banner-text'),
  retryConnection: $('#retry-connection'),
  viewVerify: $('#view-verify'),
  viewProfile: $('#view-profile'),
  heroTitle: $('#hero-title'),
  profileTitle: $('#profile-title'),
  navLinks: $$('.nav__link'),
  stepperItems: $$('.stepper__item'),
  formHeading: $('#form-heading'),
  formSubtitle: $('#form-subtitle'),
  phoneForm: $('#phone-form'),
  phone: $('#phone'),
  phoneError: $('#phone-error'),
  phonePrefix: $('#phone-prefix'),
  sendButton: $('#send-button'),
  providerNotice: $('#provider-notice'),
  countryTrigger: $('#country-trigger'),
  countryFlag: $('#country-flag'),
  countryName: $('#country-name'),
  countryDial: $('#country-dial'),
  countryPanel: $('#country-panel'),
  countrySearch: $('#country-search'),
  countryList: $('#country-listbox'),
  countryEmpty: $('#country-empty'),
  countryValue: $('#country-value'),
  codeForm: $('#code-form'),
  codeSentTo: $('#code-sent-to'),
  codeError: $('#code-error'),
  otpGroup: $('#otp-group'),
  otpAnnouncer: $('#otp-announcer'),
  expiryTimer: $('#expiry-timer'),
  expiryText: $('#expiry-text'),
  expiryProgress: $('#expiry-progress'),
  attemptsText: $('#attempts-text'),
  attemptsDots: $('#attempts-dots'),
  verifyButton: $('#verify-button'),
  resendButton: $('#resend-button'),
  resendText: $('#resend-text'),
  changeNumber: $('#change-number'),
  successPanel: $('#success-panel'),
  successTitle: $('#success-title'),
  verifiedPhone: $('#verified-phone'),
  verifiedTime: $('#verified-time'),
  verifiedProvider: $('#verified-provider'),
  successNewButton: $('#success-new-btn'),
  providerCard: $('#provider-card'),
  providerState: $('#provider-state'),
  providerName: $('#provider-name'),
  providerTtl: $('#provider-ttl'),
  providerCooldown: $('#provider-cooldown'),
  providerAttempts: $('#provider-attempts'),
  profileLoading: $('#profile-loading'),
  profileLocked: $('#profile-locked'),
  profileVerified: $('#profile-verified'),
  profileAvatar: $('#profile-avatar'),
  profilePhoneFormatted: $('#profile-phone-formatted'),
  profilePhone: $('#profile-phone'),
  profileMethod: $('#profile-method'),
  profileProvider: $('#profile-provider'),
  profileVerifiedAt: $('#profile-verified-at'),
  profileExpires: $('#profile-expires'),
  profileBenefits: $('#profile-benefits'),
  profileError: $('#profile-error'),
  profileErrorText: $('#profile-error-text'),
  profileRetry: $('#profile-retry'),
  logoutButton: $('#logout-button'),
  stepAnnouncer: $('#step-announcer'),
};

function blankSession() {
  return {
    verified: false,
    phone: null,
    phoneFormatted: null,
    phoneMasked: null,
    verifiedAt: null,
    verification: null,
    method: null,
    provider: null,
    sessionExpiresAt: null,
  };
}

const state = {
  ready: false,
  config: null,
  countries: [],
  picker: null,
  otp: null,
  session: blankSession(),
  step: 'phone',
  route: 'verify',
  loading: { send: false, verify: false, resend: false, profile: false },
  clockOffset: 0,
  expired: false,
  exhausted: false,
  lastPhone: '',
  profile: null,
  ticker: null,
};

function stateInit() {
  els.otp = new OtpInput(els.otpGroup, {
    length: 6,
    announcer: els.otpAnnouncer,
    onChange: () => {
      if (!els.codeError.hidden) clearCodeError();
    },
    onComplete: () => {
      // Deliberately no auto-submit: the user confirms with "Verify OTP".
      els.verifyButton.focus({ preventScroll: true });
    },
  });

  initTheme();
  initRouting();
  bindEvents();
  startTicker();
  void bootstrap();
}

/* ------------------------------------------------------------------ boot ---- */

async function bootstrap() {
  els.retryConnection.disabled = true;
  try {
    const config = await api.get('/api/config');
    applyConfig(config);
    state.ready = true;
    setOffline(false);
    renderSendButton();

    try {
      const session = await api.get('/api/session');
      applySession(session);
    } catch (error) {
      // Configuration loaded, so the app is usable; a failed status read simply
      // means "unverified" until the next successful call.
      if (error instanceof ApiError && error.isNetworkError) setOffline(true, error.message);
    }

    applyRoute({ focus: false });
    goToStep(deriveStep(), { focus: false });
    renderSessionPill();
  } catch (error) {
    state.ready = false;
    renderSendButton();
    if (error instanceof ApiError && error.isNetworkError) setOffline(true, error.message);
    toasts.error('OTP Shield could not start', error.message ?? 'Please reload the page.');
  } finally {
    els.retryConnection.disabled = false;
  }
}

function applyConfig(config) {
  state.config = config;
  const allowed = config.otp.allowedCountries ?? [];
  state.countries = allowed.length
    ? config.countries.filter((country) => allowed.includes(country.iso))
    : config.countries;

  const configured = Boolean(config.provider?.configured);
  els.providerCard.dataset.state = configured ? 'ready' : 'unconfigured';
  els.providerState.textContent = configured ? 'Live' : 'Not configured';
  els.providerName.textContent = config.provider?.label ?? PROVIDER_LABEL;
  els.providerTtl.textContent = `${Math.round(config.otp.ttlSeconds / 60)} minutes`;
  els.providerCooldown.textContent = pluralise(config.otp.resendCooldownSeconds, 'second');
  els.providerAttempts.textContent = String(config.otp.maxVerifyAttempts);
  setHidden(els.configBanner, configured);
  if (!configured) {
    els.configBannerText.textContent =
      'Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID to the server environment, then restart. Sending stays disabled on purpose — OTP Shield never simulates a successful verification.';
  }

  els.expiryProgress.max = config.otp.ttlSeconds;

  const initialCountry = pickInitialCountry(config, state.countries);
  if (state.picker) {
    if (initialCountry) state.picker.select(initialCountry, { close: false });
    renderSendButton();
    return;
  }
  state.picker = new CountryPicker({
    trigger: els.countryTrigger,
    panel: els.countryPanel,
    search: els.countrySearch,
    list: els.countryList,
    empty: els.countryEmpty,
    hiddenInput: els.countryValue,
    flagEl: els.countryFlag,
    nameEl: els.countryName,
    dialEl: els.countryDial,
    countries: state.countries,
    onChange: onCountryChange,
  });
  if (initialCountry) state.picker.select(initialCountry, { close: false });
  renderSendButton();
}

function pickInitialCountry(config, countries) {
  const locale = navigator.languages?.[0] ?? navigator.language ?? '';
  const region = (locale.split('-')[1] ?? '').toUpperCase();
  const available = new Set(countries.map((country) => country.iso));
  if (region && available.has(region)) return region;
  if (config.otp.defaultCountry && available.has(config.otp.defaultCountry)) {
    return config.otp.defaultCountry;
  }
  return countries[0]?.iso;
}

function onCountryChange(country) {
  els.phonePrefix.textContent = country.dialCode;
  els.phone.setAttribute(
    'aria-label',
    `Phone number without the country code, currently ${country.name} ${country.dialCode}`,
  );
  if (els.phone.value.trim()) showPhoneError(null);
}

/* ---------------------------------------------------------------- session ---- */

function syncClock(serverTime) {
  const parsed = Date.parse(serverTime ?? '');
  if (!Number.isNaN(parsed)) state.clockOffset = parsed - Date.now();
}

function nowMs() {
  return Date.now() + state.clockOffset;
}

function applySession(session) {
  if (!session) return;
  setOffline(false);
  syncClock(session.serverTime);
  state.session = { ...blankSession(), ...session };
  const verification = state.session.verification;
  const expiresAt = Date.parse(verification?.expiresAt ?? '');
  state.expired = Boolean(
    verification && !state.session.verified && !Number.isNaN(expiresAt) && expiresAt <= nowMs(),
  );
  state.exhausted = Boolean(
    verification &&
      (verification.status === 'max_attempts_reached' || verification.attemptsRemaining === 0),
  );
  renderSessionPill();
  renderAttempts();
  if (state.step === 'code') renderCodeStep();
}

async function refreshSession() {
  try {
    const session = await api.get('/api/session');
    applySession(session);
    return session;
  } catch {
    return null;
  }
}

function deriveStep() {
  if (state.session.verified) return 'verified';
  if (state.session.verification) return 'code';
  return 'phone';
}

function renderSessionPill() {
  const { verified, verification } = state.session;
  let name = 'unverified';
  let label = 'Not verified';
  if (verified) {
    name = 'verified';
    label = 'Verified';
  } else if (verification && !state.expired) {
    name = 'pending';
    label = 'Pending';
  }
  els.pill.dataset.state = name;
  els.pillLabel.textContent = label;
  els.pill.setAttribute('aria-label', `Verification status: ${label}`);
}

/* ------------------------------------------------------------------- step ---- */

function goToStep(step, { focus = true } = {}) {
  if (!STEPS.includes(step)) return;
  const changed = state.step !== step;
  state.step = step;

  const isPhone = step === 'phone';
  const isCode = step === 'code';
  const isVerified = step === 'verified';

  setHidden(els.phoneForm, !isPhone);
  setHidden(els.codeForm, !isCode);
  setHidden(els.successPanel, !isVerified);
  setHidden(els.formHeading, isVerified);
  setHidden(els.formSubtitle, isVerified);

  const copy = {
    phone: {
      heading: 'Enter your phone number',
      subtitle: 'We’ll text you a six-digit code. Standard SMS rates may apply.',
    },
    code: {
      heading: 'Enter the six-digit code',
      subtitle: 'It can take up to 30 seconds to arrive. The code expires on a timer.',
    },
    verified: { heading: '', subtitle: '' },
  }[step];
  els.formHeading.textContent = copy.heading;
  els.formSubtitle.textContent = copy.subtitle;

  const currentIndex = STEPS.indexOf(step);
  els.stepperItems.forEach((item) => {
    const index = STEPS.indexOf(item.dataset.step);
    const isCurrent = item.dataset.step === step;
    if (isCurrent) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
    item.classList.toggle('is-complete', index < currentIndex);
    item.setAttribute(
      'aria-label',
      `${item.dataset.step === 'phone' ? 'Phone number' : item.dataset.step === 'code' ? 'Code entry' : 'Verified'} step${isCurrent ? ', current step' : index < currentIndex ? ', completed' : ', not started'}`,
    );
  });

  if (isCode) renderCodeStep();
  if (isVerified) renderSuccess();

  if (changed) {
    const messages = {
      phone: 'Step 1 of 3. Enter your phone number.',
      code: `Step 2 of 3. Enter the six-digit code sent to ${state.session.phoneMasked ?? 'your phone'}.`,
      verified: 'Step 3 of 3. Your phone number is verified.',
    };
    els.stepAnnouncer.textContent = messages[step];
  }

  if (focus) {
    if (isPhone) focusElement(els.phone);
    else if (isCode) els.otp.focus();
    else if (isVerified) focusElement(els.successTitle);
  }
}

function renderCodeStep() {
  els.codeSentTo.textContent = state.session.phoneMasked ?? 'your phone';
  renderAttempts();
  renderVerifyButton();
  renderResendButton();
  els.otp.setDisabled(state.expired || state.exhausted);
  if (state.expired) {
    showCodeError('This code has expired. Request a new one to continue.');
  } else if (state.exhausted) {
    showCodeError('Too many incorrect codes. Request a new code to try again.');
  }
  updateTimers();
}

function renderSuccess() {
  const session = state.session;
  els.verifiedPhone.textContent = session.phoneFormatted ?? session.phoneMasked ?? 'Your number';
  els.verifiedTime.textContent = session.verifiedAt ? formatClock(session.verifiedAt) : 'just now';
  els.verifiedProvider.textContent = session.provider?.label ?? PROVIDER_LABEL;
}

function renderAttempts() {
  if (!state.config) return;
  const max = state.config.otp.maxVerifyAttempts;
  const verification = state.session.verification;
  const remaining = verification
    ? Math.max(0, verification.attemptsRemaining ?? max)
    : max;
  els.attemptsText.textContent =
    remaining === 0 ? 'No attempts left' : `${pluralise(remaining, 'attempt')} left`;

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < max; index += 1) {
    const dot = h('span', index < max - remaining ? 'attempts__dot is-used' : 'attempts__dot');
    fragment.appendChild(dot);
  }
  els.attemptsDots.replaceChildren(fragment);
}

function renderVerifyButton() {
  const busy = state.loading.verify;
  els.verifyButton.disabled = busy || state.expired || state.exhausted;
  els.verifyButton.setAttribute('aria-busy', String(busy));
  els.verifyButton.querySelector('.button__label').textContent = busy ? 'Verifying…' : 'Verify OTP';
}

function renderSendButton() {
  const busy = state.loading.send;
  const providerReady = state.config?.provider?.configured !== false && state.ready;
  els.sendButton.disabled = busy || !providerReady;
  els.sendButton.setAttribute('aria-busy', String(busy));
  els.sendButton.querySelector('.button__label').textContent = busy ? 'Sending…' : 'Send OTP';
  els.phone.disabled = busy;
  els.countryTrigger.disabled = busy;
  setHidden(els.providerNotice, providerReady || !state.config);
}

function resendSecondsRemaining() {
  const verification = state.session.verification;
  if (!verification?.resendAvailableAt) return 0;
  const at = Date.parse(verification.resendAvailableAt);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.ceil((at - nowMs()) / 1000));
}

function renderResendButton() {
  const seconds = resendSecondsRemaining();
  const busy = state.loading.resend || state.loading.send;
  els.resendButton.disabled = busy || seconds > 0 || !state.session.verification;
  setText(els.resendButton, busy ? 'Resending…' : 'Resend code');
  setText(
    els.resendText,
    seconds > 0 ? `You can resend in ${seconds}s` : 'Didn’t get the code?',
  );
}

function setText(element, text) {
  if (element && element.textContent !== text) element.textContent = text;
}

/* ----------------------------------------------------------------- timers ---- */

function startTicker() {
  if (state.ticker) clearInterval(state.ticker);
  state.ticker = setInterval(updateTimers, 500);
}

function updateTimers() {
  const verification = state.session.verification;
  if (!verification || state.session.verified) {
    if (state.step === 'code') renderResendButton();
    return;
  }
  const ttl = state.config?.otp.ttlSeconds ?? 600;
  const expiresAt = Date.parse(verification.expiresAt);
  const remaining = Number.isNaN(expiresAt)
    ? 0
    : Math.max(0, Math.ceil((expiresAt - nowMs()) / 1000));

  setText(els.expiryText, formatCountdown(remaining));
  if (els.expiryProgress.max !== ttl) els.expiryProgress.max = ttl;
  els.expiryProgress.value = Math.min(ttl, remaining);
  els.expiryProgress.setAttribute('aria-valuetext', `${formatCountdown(remaining)} remaining`);
  const urgency = remaining === 0 ? 'expired' : remaining <= 60 ? 'urgent' : 'normal';
  els.expiryTimer.dataset.state = urgency;
  els.expiryProgress.dataset.state = urgency;

  if (remaining === 0 && !state.expired) {
    state.expired = true;
    renderSessionPill();
    if (state.step === 'code') {
      els.otp.setDisabled(true);
      renderVerifyButton();
      showCodeError('This code has expired. Request a new one to continue.');
    }
  }

  if (state.step === 'code') renderResendButton();
}

function applyCooldown(seconds) {
  if (!state.session.verification || !Number.isFinite(seconds)) return;
  state.session.verification.resendAvailableAt = new Date(
    nowMs() + Math.max(1, seconds) * 1000,
  ).toISOString();
  renderResendButton();
}

/* ---------------------------------------------------------------- actions ---- */

function clientValidatePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 0) return 'Enter your phone number.';
  if (digits.length < 5) return 'That number looks too short. Include the area or mobile prefix.';
  if (digits.length > 15) return 'Phone numbers cannot have more than 15 digits.';
  return null;
}

async function handleSend(event) {
  event.preventDefault();
  if (state.loading.send || !state.ready) return;

  clearPhoneError();
  const phone = els.phone.value.trim();
  const country = els.countryValue.value;
  const clientError = clientValidatePhone(phone);
  if (clientError) {
    showPhoneError(clientError);
    focusElement(els.phone);
    return;
  }

  state.loading.send = true;
  renderSendButton();
  try {
    const data = await api.post('/api/otp/send', { phone, country });
    state.lastPhone = phone;
    state.expired = false;
    state.exhausted = false;
    applySession(data);
    els.otp.clear();
    clearCodeError();
    els.otp.setDisabled(false);
    goToStep('code');
    toasts.success('Code sent', data.message);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'resend_too_soon') {
      applyCooldown(error.retryAfterSeconds ?? 30);
      if (state.session.verification) goToStep('code');
      toasts.info('Code already sent', error.message);
    } else if (error instanceof ApiError && error.code === 'invalid_phone') {
      showPhoneError(error.message);
      focusElement(els.phone);
      toasts.error('Check your number', error.message);
    } else if (error instanceof ApiError && error.fieldErrors?.phone) {
      showPhoneError(error.fieldErrors.phone);
      focusElement(els.phone);
    } else {
      presentError(error, 'Could not send the code');
    }
  } finally {
    state.loading.send = false;
    renderSendButton();
    if (state.step === 'code') renderResendButton();
  }
}

async function handleVerify(event) {
  event.preventDefault();
  if (state.loading.verify || state.expired) return;

  const code = els.otp.value;
  if (code.length !== 6) {
    showCodeError('Enter all six digits of the code.');
    els.otp.setError(true);
    els.otp.focus();
    return;
  }

  clearCodeError();
  state.loading.verify = true;
  renderVerifyButton();
  try {
    const data = await api.post('/api/otp/verify', { code });
    state.profile = null;
    state.expired = false;
    state.exhausted = false;
    applySession(data);
    els.otp.clear();
    goToStep('verified');
    toasts.success(
      'Phone verified',
      `${data.phoneFormatted ?? data.phoneMasked ?? 'Your number'} is now verified.`,
    );
  } catch (error) {
    handleVerifyError(error);
  } finally {
    state.loading.verify = false;
    renderVerifyButton();
  }
}

function handleVerifyError(error) {
  if (!(error instanceof ApiError)) {
    toasts.error('Could not verify the code', 'Please try again.');
    return;
  }

  switch (error.code) {
    case 'invalid_code': {
      const remaining = error.details?.attemptsRemaining;
      if (state.session.verification && typeof remaining === 'number') {
        state.session.verification.attemptsRemaining = remaining;
      }
      renderAttempts();
      showCodeError(
        remaining === 0
          ? error.message
          : `Incorrect code. ${pluralise(remaining, 'attempt')} left.`,
        { shake: true },
      );
      els.otp.clear({ focus: true });
      toasts.error('Incorrect code', 'Check the SMS and try again.');
      return;
    }
    case 'attempts_exhausted':
      state.exhausted = true;
      showCodeError('Too many incorrect codes. Request a new code to try again.');
      els.otp.clear();
      els.otp.setDisabled(true);
      renderVerifyButton();
      renderSessionPill();
      toasts.error('Too many attempts', 'Request a new code to try again.');
      return;
    case 'code_expired':
    case 'verification_not_found':
      state.expired = true;
      showCodeError(error.message);
      els.otp.setDisabled(true);
      renderVerifyButton();
      renderSessionPill();
      toasts.error('Code expired', error.message);
      return;
    case 'already_verified':
      state.profile = null;
      toasts.success('Already verified', error.message);
      void refreshSession().then((session) => {
        if (session?.verified) goToStep('verified');
      });
      return;
    case 'no_active_verification':
      toasts.error('Verification ended', 'Request a new code to continue.');
      goToStep('phone');
      return;
    case 'provider_unavailable':
    case 'provider_auth_failed':
    case 'provider_rate_limited':
      presentError(error, 'Could not verify the code');
      return;
    default:
      presentError(error, 'Could not verify the code');
  }
}

async function handleResend() {
  if (state.loading.resend || els.resendButton.disabled) return;
  state.loading.resend = true;
  renderResendButton();
  try {
    const data = await api.post('/api/otp/resend');
    state.expired = false;
    state.exhausted = false;
    applySession(data);
    els.otp.clear({ focus: true });
    els.otp.setDisabled(false);
    clearCodeError();
    renderAttempts();
    renderVerifyButton();
    toasts.success('New code sent', data.message);
  } catch (error) {
    if (error instanceof ApiError && error.retryAfterSeconds) {
      applyCooldown(error.retryAfterSeconds);
    }
    if (error instanceof ApiError && error.code === 'no_active_verification') {
      toasts.error('Verification ended', 'Enter your number again to request a code.');
      goToStep('phone');
    } else if (error instanceof ApiError && error.code === 'resend_too_soon') {
      toasts.info('Please wait', error.message);
    } else {
      presentError(error, 'Could not resend the code');
    }
  } finally {
    state.loading.resend = false;
    renderResendButton();
    renderSendButton();
  }
}

function startOver() {
  state.expired = false;
  state.exhausted = false;
  state.profile = null;
  els.otp.clear();
  clearCodeError();
  els.otp.setDisabled(false);
  renderAttempts();
  renderVerifyButton();
  if (state.lastPhone) els.phone.value = state.lastPhone;
  goToStep('phone');
}

async function handleLogout() {
  try {
    await api.post('/api/session/logout');
  } catch (error) {
    if (error instanceof ApiError && error.isNetworkError) {
      presentError(error, 'Could not sign out');
      return;
    }
    // A failed revoke still must not leave the UI claiming "verified".
  }
  state.session = blankSession();
  state.profile = null;
  state.lastPhone = '';
  state.expired = false;
  state.exhausted = false;
  els.phone.value = '';
  els.otp.clear();
  clearCodeError();
  clearPhoneError();
  renderSessionPill();
  renderAttempts();
  renderProfileLocked();
  renderVerifyButton();
  renderResendButton();
  goToStep('phone');
  toasts.info('Signed out', 'This session is no longer verified.');
}

/* ---------------------------------------------------------------- profile ---- */

async function loadProfile() {
  if (state.loading.profile) return;
  state.loading.profile = true;
  setHidden(els.profileError, true);
  setHidden(els.profileLoading, Boolean(state.profile));

  try {
    try {
      const session = await api.get('/api/session');
      applySession(session);
    } catch (error) {
      if (error instanceof ApiError && error.isNetworkError) throw error;
    }

    if (!state.session.verified) {
      state.profile = null;
      renderProfileLocked();
      return;
    }

    const data = await api.get('/api/profile');
    state.profile = data.profile;
    renderProfile(data);
    if (data.session) applySession(data.session);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'verification_required') {
      state.profile = null;
      renderProfileLocked();
    } else {
      showProfileError(error);
    }
  } finally {
    state.loading.profile = false;
    setHidden(els.profileLoading, true);
  }
}

function renderProfile(data) {
  const profile = data.profile ?? {};
  const iso = isoFromPhone(profile.phone);
  els.profileAvatar.textContent = iso || 'ID';
  els.profileAvatar.title = iso ? flagEmoji(iso) : '';
  els.profilePhoneFormatted.textContent = profile.phoneFormatted ?? profile.phoneMasked ?? '—';
  els.profilePhone.textContent = profile.phone ?? profile.phoneMasked ?? '—';
  els.profileMethod.textContent = `${String(profile.method ?? 'sms').toUpperCase()} code`;
  els.profileProvider.textContent = profile.provider ?? PROVIDER_LABEL;
  els.profileVerifiedAt.textContent = formatDateTime(profile.verifiedAt);
  const expiresAt = data.session?.sessionExpiresAt;
  els.profileExpires.textContent = expiresAt ? formatDateTime(expiresAt) : '—';

  const items = (profile.benefits ?? []).map((benefit) => {
    const li = document.createElement('li');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm5 12.6 4.2 4.2L19 7');
    svg.appendChild(path);
    li.append(svg, document.createTextNode(benefit));
    return li;
  });
  els.profileBenefits.replaceChildren(...items);

  setHidden(els.profileLoading, true);
  setHidden(els.profileLocked, true);
  setHidden(els.profileVerified, false);
  setHidden(els.profileError, true);
}

function renderProfileLocked() {
  setHidden(els.profileLoading, true);
  setHidden(els.profileVerified, true);
  setHidden(els.profileError, true);
  setHidden(els.profileLocked, false);
}

function showProfileError(error) {
  setHidden(els.profileLoading, true);
  setHidden(els.profileVerified, true);
  setHidden(els.profileLocked, true);
  setHidden(els.profileError, false);
  els.profileErrorText.textContent =
    error?.message ?? 'We could not load your profile. Please try again.';
  if (error instanceof ApiError && error.isNetworkError) setOffline(true, error.message);
}

function isoFromPhone(phone) {
  const countries = state.config?.countries ?? [];
  let best = null;
  for (const country of countries) {
    if (phone?.startsWith(country.dialCode)) {
      if (!best || country.dialCode.length > best.dialCode.length) best = country;
    }
  }
  return best?.iso ?? null;
}

/* ---------------------------------------------------------------- helpers ---- */

function showPhoneError(message) {
  // Unhide before writing so role="alert" reliably announces the new text.
  if (message) setHidden(els.phoneError, false);
  els.phoneError.textContent = message ?? '';
  setHidden(els.phoneError, !message);
  els.phone.setAttribute('aria-invalid', message ? 'true' : 'false');
  els.phone.parentElement.classList.toggle('has-error', Boolean(message));
}

function clearPhoneError() {
  showPhoneError(null);
}

function showCodeError(message, { shake = false } = {}) {
  if (message) setHidden(els.codeError, false);
  els.codeError.textContent = message ?? '';
  setHidden(els.codeError, !message);
  els.otp.setError(Boolean(message));
  if (message && shake) {
    els.otpGroup.classList.remove('is-error');
    // Restart the animation without inline styles.
    void els.otpGroup.offsetWidth;
    els.otpGroup.classList.add('is-error');
  }
  if (message) els.otp.announce(message);
}

function clearCodeError() {
  showCodeError(null);
}

function presentError(error, title) {
  if (error instanceof ApiError && error.isNetworkError) {
    setOffline(true, error.message);
    toasts.error('Connection problem', error.message);
    return;
  }
  if (error instanceof ApiError && error.code === 'provider_not_configured') {
    setHidden(els.configBanner, false);
    toasts.error('SMS is not configured', error.message);
    return;
  }
  if (
    error instanceof ApiError &&
    ['rate_limited', 'too_many_sends', 'provider_rate_limited'].includes(error.code)
  ) {
    if (error.retryAfterSeconds) applyCooldown(error.retryAfterSeconds);
    toasts.error('Too many requests', error.message);
    return;
  }
  if (error instanceof ApiError && error.fieldErrors) {
    if (error.fieldErrors.phone) showPhoneError(error.fieldErrors.phone);
    if (error.fieldErrors.code) showCodeError(error.fieldErrors.code);
    return;
  }
  toasts.error(title, error?.message ?? 'Please try again.');
}

function setOffline(isOffline, message) {
  setHidden(els.offlineBanner, !isOffline);
  if (isOffline && message) els.offlineBannerText.textContent = message;
  if (!isOffline) {
    els.offlineBannerText.textContent =
      'Check your internet connection and try again. Nothing was sent or verified.';
  }
}

/* ---------------------------------------------------------------- theming ---- */

function initTheme() {
  syncThemeButton(document.documentElement.dataset.theme ?? 'dark');
  els.themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('otp-shield-theme', next);
    } catch {
      /* storage can be blocked; the toggle still works for this page */
    }
    syncThemeButton(next);
  });
}

function syncThemeButton(theme) {
  const isLight = theme === 'light';
  els.themeToggle.setAttribute('aria-pressed', String(isLight));
  els.themeToggle.setAttribute('aria-label', 'Light theme');
  els.themeToggle.title = isLight ? 'Switch to dark theme' : 'Switch to light theme';
}

/* ---------------------------------------------------------------- routing ---- */

function initRouting() {
  if (!location.hash) history.replaceState(null, '', '#/verify');
  window.addEventListener('hashchange', () => applyRoute({ focus: true }));
}

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '').toLowerCase();
  return hash === 'profile' ? 'profile' : 'verify';
}

function applyRoute({ focus = false } = {}) {
  const route = parseRoute();
  const changed = route !== state.route;
  state.route = route;

  setHidden(els.viewVerify, route !== 'verify');
  setHidden(els.viewProfile, route !== 'profile');
  document.title =
    route === 'profile'
      ? 'Profile verification status · OTP Shield'
      : 'OTP Shield — Real SMS phone verification';
  for (const link of els.navLinks) {
    if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  if (route === 'profile') {
    void loadProfile();
  } else if (changed) {
    renderSessionPill();
    goToStep(deriveStep(), { focus: false });
  }

  if (focus && changed) {
    const heading = route === 'profile' ? els.profileTitle : els.heroTitle;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: false });
  }
}

/* ----------------------------------------------------------------- events ---- */

function bindEvents() {
  els.phoneForm.addEventListener('submit', handleSend);
  els.codeForm.addEventListener('submit', handleVerify);
  els.resendButton.addEventListener('click', handleResend);
  els.changeNumber.addEventListener('click', startOver);
  els.successNewButton.addEventListener('click', async () => {
    location.hash = '#/verify';
    await handleLogout();
  });
  els.logoutButton.addEventListener('click', handleLogout);
  els.profileRetry.addEventListener('click', () => loadProfile());
  els.retryConnection.addEventListener('click', () => void bootstrap());

  els.phone.addEventListener('input', () => {
    if (!els.phoneError.hidden) clearPhoneError();
  });

  window.addEventListener('online', () => {
    setOffline(false);
    toasts.info('Back online', 'You can continue verifying.');
  });
  window.addEventListener('offline', () => {
    setOffline(true, 'You appear to be offline. Check your connection — nothing was sent.');
  });
}

/* Boot once every module-level binding exists. */
stateInit();
