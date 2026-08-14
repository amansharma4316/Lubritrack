// ============================================================
// SHARED SUPABASE CLIENT
// Loaded before supabase-api.js (on index.html) and before
// login.js (on login.html), so the URL/key only live in one
// place.
// ============================================================
const SUPABASE_URL = 'https://pebskcsmpbvfbwrowtmn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlYnNrY3NtcGJ2ZmJ3cm93dG1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1MTQ1MDYsImV4cCI6MjEwMjA5MDUwNn0.7y8w1vf1tq3i5st8sybtL8rQ0RlAjb5kdqdmtkhyWMs';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
