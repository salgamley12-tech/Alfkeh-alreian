# دفتر البيع والديون

تطبيق جوال عربي لتسجيل العملاء والمبيعات والديون والدفعات الجزئية. يعمل دون إنترنت ويحفظ بياناته محليًا باستخدام SQLite.

## بناء APK عبر GitHub Actions

1. افتح تبويب Actions في المستودع.
2. اختر Build Android APK ثم Run workflow.
3. بعد اكتمال البناء، افتح صفحة التشغيل، ثم حمّل artifact باسم debt-sales-tracker-apk.
4. فك ضغط الملف وثبّت app-debug.apk على Android.

## تشغيل محليًا

```sh
npm install
npx expo start
