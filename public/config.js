// Public presentation settings only. Passwords and submission data stay on the server.
export const config = Object.freeze({
  department: 'Department of Chemistry',
  mode: 'server', // Built-in private storage. No Google account or external service required.
  googleClientId: '',
  googleScriptUrl: '',
  emailEnabled: false, // Submission/status emails stay disabled. Office password-change emails require separate backend setup.
  maxImageBytes: 10 * 1024 * 1024,
  maxImages: 3,
});
