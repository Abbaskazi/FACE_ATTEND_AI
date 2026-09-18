# FaceAttend AI - Development Guidelines

## Project

FaceAttend AI is an AI-powered employee attendance platform.

The project consists of:

- Android application for employee registration and attendance
- Web application for administrator management
- Supabase backend
- On-device face recognition

## Architecture

Android:
- Kotlin
- Jetpack Compose
- CameraX
- ML Kit
- ONNX Runtime

Web:
- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui

Backend:
- Supabase
- PostgreSQL
- Supabase Auth
- Row Level Security

AI:
- Face detection
- Face alignment
- Face embedding
- Face verification
- Liveness / anti-spoofing

## Security Rules

1. Never store passwords in application tables.
2. Never commit secrets or API keys.
3. Never hardcode credentials.
4. Use environment variables for secrets.
5. Use Supabase Row Level Security.
6. Never trust client-side authorization.
7. Validate all user input.
8. Use server-side timestamps for attendance.
9. Prevent duplicate attendance records.
10. Minimize storage of raw biometric images.
11. Protect biometric templates.
12. Do not expose biometric data unnecessarily.
13. Do not disable security controls simply to make development easier.

## Development Rules

- Keep Android and web applications separate.
- Prefer small, testable components.
- Do not introduce unnecessary dependencies.
- Explain significant architectural changes before implementing them.
- Do not replace working architecture without a reason.
- Run tests/build checks after significant changes.
- Never delete working functionality without explicit approval.

## Git Rules

- Use meaningful commit messages.
- Do not commit secrets.
- Do not commit large model files unless explicitly approved.
- Keep commits focused on one logical change.

## AI Rules

Before implementing major features:

1. Inspect the existing repository.
2. Understand the current architecture.
3. Reuse existing components where appropriate.
4. Avoid unnecessary rewrites.
5. Verify the implementation after changes.