# Android enrollment configuration

The enrollment screen requires the public Supabase URL and publishable/anon
key at build time. They are public client configuration values, not service
credentials, and are intentionally not committed:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
```

Build with environment variables or Gradle properties:

```powershell
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_ANON_KEY = "your-public-anon-or-publishable-key"
./gradlew.bat assembleDebug
```

The attendance device signs in with its provisioned Supabase Auth account at
runtime. Credentials and access tokens are not stored by the app. An admin
creates a one-time enrollment session from the web employee directory and
transfers only that opaque token to the device.

## Attendance liveness model

Attendance uses the bundled `minifasnet_v2.onnx` MiniFASNetV2 anti-spoof model
from the Apache-2.0 Silent-Face-Anti-Spoofing project. The exact ONNX
conversion is the `garciafido/minifasnet-v2-anti-spoofing-onnx` artifact,
1,744,116 bytes, SHA-256
`d7b3cd9ba8a7ceb13baa8c4720902e27ca3112eff52f926c08804af6b6eecc7b`.
The original Apache-2.0 license is bundled as
`app/src/main/assets/MINIFASNET_LICENSE.txt`.

The verified graph accepts dynamic-batch `[N, 3, 80, 80]` float32 NCHW BGR
pixels scaled by `1/255` and returns `[N, 3]` float32 logits. Upstream
MiniFASNetV2 labels class 1 as live; the app applies softmax and uses that
probability. Each frame uses the upstream 2.7x face-box crop. Attendance
requires 20 valid frames from one ML Kit tracking ID, a median live score of
at least `0.80`, and at least 15/20 frame scores at or above `0.80`.
