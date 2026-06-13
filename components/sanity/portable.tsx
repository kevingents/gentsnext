import { PortableText, type PortableTextComponents } from "@portabletext/react";
import { urlForImage } from "@/lib/sanity";

const components: PortableTextComponents = {
  types: {
    image: ({ value }) => {
      const url = urlForImage(value, 1200);
      if (!url) return null;
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={value?.alt || ""} className="my-6 h-auto max-w-full rounded-card" loading="lazy" />
      );
    },
  },
};

export function PortableContent({ value }: { value: any[] }) {
  return (
    <div className="prose-gents">
      <PortableText value={value} components={components} />
    </div>
  );
}
