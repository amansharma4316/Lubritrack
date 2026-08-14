// ============================================================
// LOGIN PAGE LOGIC — email + password via Supabase Auth
// ============================================================

window.addEventListener('DOMContentLoaded', async function () {
  // Already signed in? Skip straight to the app.
  try {
    var { data: { session } } = await sb.auth.getSession();
    if (session) { window.location.href = 'index.html'; return; }
  } catch (e) { /* fall through to showing the login form */ }

  document.getElementById('login-form').addEventListener('submit', handleLogin);
});

async function handleLogin(e) {
  e.preventDefault();
  var email = document.getElementById('login-email').value.trim();
  var password = document.getElementById('login-password').value;
  var btn = document.getElementById('login-btn');
  var err = document.getElementById('login-err');
  var ok  = document.getElementById('login-ok');
  err.style.display = 'none';
  ok.style.display = 'none';

  if (!email || !password) {
    err.textContent = 'Enter both email and password.';
    err.style.display = 'block';
    return;
  }

  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    var { data, error } = await sb.auth.signInWithPassword({ email: email, password: password });
    if (error) {
      err.textContent = error.message;
      err.style.display = 'block';
      return;
    }
    window.location.href = 'index.html';
  } catch (ex) {
    err.textContent = ex.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}

async function handleForgotPassword() {
  var email = document.getElementById('login-email').value.trim();
  var err = document.getElementById('login-err');
  var ok  = document.getElementById('login-ok');
  err.style.display = 'none';
  ok.style.display = 'none';

  if (!email) {
    err.textContent = 'Enter your email above first, then click "Forgot password".';
    err.style.display = 'block';
    return;
  }

  try {
    var { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password.html'
    });
    if (error) {
      err.textContent = error.message;
      err.style.display = 'block';
      return;
    }
    ok.textContent = 'If that email has an account, a reset link has been sent.';
    ok.style.display = 'block';
  } catch (ex) {
    err.textContent = ex.message;
    err.style.display = 'block';
  }
}
