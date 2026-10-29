import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { createClient } from '@/lib/supabase/server';
import { CodeGiftBuilderForm } from '@/components/code/CodeGiftBuilderForm';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Code — ${BRAND.NAME} builder`,
};

/**
 * /create/code — builder route for the `code` gift type (OOP-5688).
 *
 * The sender writes HTML, CSS and JavaScript. The gift is scanned for
 * safety before it can be saved, previewed live in the same sandbox the
 * recipient will see, and can be run past the AI reviewer for suggestions
 * the sender can apply one at a time.
 *
 * Auth: requires a signed-in user. Anonymous users land on /login with
 * `next` pointing back here.
 */
export default async function CreateCodePage({ params }: PageProps<'/[locale]/create/code'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Builder.code');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/create/code');
  }

  return (
    <main className="min-h-screen flex flex-col">
      <Nav />

      <section className="lb-settings-card">
        <p className="lb-auth-foot" style={{ marginBottom: 8 }}>
          <Link href="/create">← {t('backToPicker')}</Link>
        </p>
        <h1>{t('heading')}</h1>
        <p className="lede">{t('lede')}</p>

        <CodeGiftBuilderForm />

        <p className="lb-auth-foot">{t('privacyNote')}</p>
      </section>
    </main>
  );
}
