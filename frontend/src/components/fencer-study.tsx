import Image from "next/image";

/** Original comic mascot: white kit, Macedonian flag mask, idle and sword cut. */
export function FencerStudy() {
  return (
    <div className="fencer-mascot" aria-hidden="true">
      <div className="fencer-frame">
        <Image className="fencer-study" src="/fencer-comic.png" width={224} height={256} alt="" unoptimized priority />
        <span className="fencer-strip" />
      </div>
    </div>
  );
}
