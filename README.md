# NOOR Platform | منصة نور

منصة لإدارة الحياة الشخصية والعمل: NOOR Personal وNOOR Work.

[فتح المنصة](https://noor-personal.onrender.com) · [NOOR Lifecycle — السجل الرئيسي](https://github.com/engaboali9226-mastoura/work-tracker_OS/issues/253) · [سجل الإصدار](https://github.com/engaboali9226-mastoura/work-tracker_OS/issues/254) · [سجل التطوير](https://github.com/engaboali9226-mastoura/work-tracker_OS/issues/271)

## استئناف العمل مع أدوات الذكاء الاصطناعي

انسخ البرومبت التالي في محادثة جديدة:

```text
استأنف العمل على منصة NOOR وفق نظام NOOR Lifecycle.
المستودع: engaboali9226-mastoura/work-tracker_OS
السجل الرئيسي: https://github.com/engaboali9226-mastoura/work-tracker_OS/issues/253
اقرأ السجل الرئيسي وتعليمات العمل، وحدد الإصدار الجاري فحصه والمحاور المتبقية، واستأنف التنفيذ من آخر نقطة موثقة. لا تكرر الفحوصات السابقة دون مبرر، وسجل نتائجك وأدلتك والمشكلات المكتشفة في القضايا المخصصة لها. التزم ببوابات الجودة وسياسة النشر المحمي Policy-v5. لا تعدل الكود أو بيانات الإنتاج أو تنشر أثناء المراجعة. أنجز أكبر قدر ممكن من العمل في الجلسة الحالية ثم وثق نقطة الاستئناف بدقة.
```

اقرأ [AGENTS.md](AGENTS.md) و[دليل دورة الحياة](docs/noor-lifecycle/README.md). إذا لم يتوفر موصل GitHub، اطلب حزمة المصدر المثبتة بدل افتراض الوصول.

## Architecture

Component Based Architecture: Runtime, Domain, Application, Infrastructure, Components, Applications.

Applications: Forge CLI, Web. Components: Kernel, Workday, Attendance, Tasks, Dashboard, Notifications, Reports, Analytics, Integrations.

The preceding architecture inventory is retained from the historical Work Tracker OS README; verify actual current capabilities in the release registry rather than assuming every historical component is active.

## Repository and release

Production branch: `product/noor-personal-mvp`. Hosting: Render. Data/auth: Supabase. The lifecycle registry is the source of truth for the active release, exact SHA, findings and audit status. No automatic production deployment. Follow Policy-v5 for all publication.
