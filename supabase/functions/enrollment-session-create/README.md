# enrollment-session-create

Admin-authenticated capability issuer for employee enrollment.

The caller must be a signed-in active admin. The function accepts an employee
ID only on this admin path, checks that the employee is active and not already
enrolled, and returns a cryptographically random one-time token. Only the
SHA-256 token hash is stored in `enrollment_sessions`; the raw token is
returned once so an operator can transfer it to the enrollment device.

The enrollment device must never choose an employee ID. It submits this opaque
token to `enrollment-submit`.
