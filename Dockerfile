# استخدام إصدار Node.js 22 LTS مستقر وخفيف الوزن
FROM node:22-alpine

# تحديد مجلد العمل داخل الحاوية
WORKDIR /app

# نسخ ملفات الحزم أولاً للاستفادة من التخزين المؤقت (Caching)
COPY package*.json ./

# تثبيت كافة الحزم المطلوبة (تشمل tsx و vite لبناء وتشغيل التطبيق)
RUN npm ci

# نسخ باقي ملفات المشروع
COPY . .

# بناء واجهة React الأمامية لإنتاج مجلد dist
RUN npm run build

# إنشاء مجلد data لضمان عمل التخزين المحلي بسلاسة
RUN mkdir -p data

# ضبط متغيرات البيئة لوضع الإنتاج والمنفذ الافتراضي لـ Cloud Run
ENV NODE_ENV=production
ENV PORT=8080

# فتح المنفذ المطلوب
EXPOSE 8080

# أمر التشغيل النهائي للإنتاج
CMD ["npm", "start"]