import Link from 'next/link';
import { pageMetadata } from '@/lib/site-metadata';
export const metadata = pageMetadata('/about', 'How it works', 'The research and evidence behind the funding directory.');
export default function About() {
  return <article className="about-page"><Link href="/programs" className="back-link">← Explore opportunities</Link><p className="hero-kicker">The research behind the directory</p><h1 className="display">About grants.watch</h1><p className="about-lead">grants.watch brings funding opportunities across crypto, AI and open source into one searchable place, drawing on Grant Wire research and official program sources.</p>
    <section><h2>How programs are added</h2><p>We retain useful opportunities beyond the day they were discovered. New announcements, changed deadlines and revised eligibility can all lead to updates. A program does not need to appear in the newsletter to belong in this directory.</p></section>
    <section><h2>How to read a program</h2><p>Each program page gives its status, how it takes applications and its next published deadline. Status describes whether the program is running. A passed deadline moves into round history without changing the program’s status.</p><p>Sources and recorded check dates stay with each fact. Review schedules do not hide those facts. Follow the funder’s page for its terms.</p></section>
    <section><h2>Missing information</h2><p>An unrecorded amount stays explicit. An unavailable source remains a review task. Funding totals, individual grant sizes, token awards and credits are kept distinct where sources make that distinction. Older records are available to explore, with uncertainty stated.</p></section>
    <section><h2>Coverage</h2><p>The directory covers the opportunities collected through our research. Coverage varies by ecosystem and source, and we do not claim to include every opportunity online. “Noted” dates record when a source was checked.</p></section>
    <Link href="/programs" className="primary-link main-action">Browse programs</Link>
  </article>;
}
