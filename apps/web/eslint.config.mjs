// ---------------------------------------------------------------------------
// ESLint yapılandırması (flat config).
//
// Bu dosyadan önce `npm run lint` çalışmıyordu: package.json'daki `next lint`
// Next 16'da kaldırılmış, projede de eslint kurulu değildi. Yani lint bu
// depoda hiç çalışmamıştı — kurallar vardı ama kimse uygulamıyordu.
//
// Kural seçimi bilinçli olarak dar tutuldu: amaç stil tartışması açmak değil,
// derleyicinin yakalamadığı GERÇEK hataları yakalamak. Gürültülü bir lint,
// kapatılan bir lint olur.
//
// Tip bilgisi gerektiren kurallar (no-floating-promises gibi) yalnızca
// TypeScript dosyalarına uygulanır ve parser orada açıkça belirtilir:
// eslint-config-next kendi parser'ını dayatır, o da tip bilgisini
// iletmediği için bu kurallar sessizce çalışmaz halde kalırdı.
// ---------------------------------------------------------------------------
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from 'eslint-config-next';

export default tseslint.config(
  {
    // Üretilen dosyalar denetlenmez: bizim yazdığımız kod değil.
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'eslint.config.mjs'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,

  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Kullanılmayan değişken çoğu zaman yarım kalmış bir düzenlemedir.
      // `_` önekli olanlar bilinçli olarak yok sayılır (yakalanan ama
      // kullanılmayan hata nesneleri gibi).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // `any` tip sistemini o noktada tamamen kapatır. Uyarı olarak kalır:
      // hata yapmak mevcut kodu bir anda kırardı, ama yenisini de sessizce
      // içeri almamalıyız.
      '@typescript-eslint/no-explicit-any': 'warn',

      // await'i unutulmuş bir Promise sessizce kaybolur — sunucu bileşenlerinde
      // bu, hiç çalışmamış bir veri çağrısı demektir.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
);
