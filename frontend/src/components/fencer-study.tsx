import { useId } from "react";

/** An illustrative mask and jacket study, not a body scan or a medical readout. */
export function FencerStudy() {
  const id = useId();
  const fill = (name: string) => `url(#${id}-${name})`;
  return (
    <svg className="fencer-study" viewBox="0 0 360 400" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-cloth`} x1="0" y1="0" x2="1" y2=".4">
          <stop stopColor="#aab4ab" /><stop offset=".35" stopColor="#f4f5e9" />
          <stop offset=".6" stopColor="#e7ebe1" /><stop offset="1" stopColor="#b4c0b3" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2=".6">
          <stop stopColor="#657567" /><stop offset=".3" stopColor="#e4e9dc" />
          <stop offset=".6" stopColor="#f9faf1" /><stop offset="1" stopColor="#92a28e" />
        </linearGradient>
        <linearGradient id={`${id}-face`} x1="0" y1="0" x2="1" y2=".6">
          <stop stopColor="#26372e" /><stop offset=".4" stopColor="#354d3c" />
          <stop offset=".75" stopColor="#64745c" /><stop offset="1" stopColor="#2c4230" />
        </linearGradient>
        <radialGradient id={`${id}-sheen`} cx=".65" cy=".2" r=".8">
          <stop stopColor="#e6ebce" stopOpacity=".5" /><stop offset="1" stopColor="#e6ebce" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset=".7" stopColor="white" /><stop offset="1" stopColor="black" />
        </linearGradient>
        <pattern id={`${id}-mesh`} width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M0 0 4 4M4 0 0 4" stroke="#d8e2c7" strokeWidth=".45" opacity=".65" />
        </pattern>
        <pattern id={`${id}-weave`} width="3" height="3" patternUnits="userSpaceOnUse">
          <path d="M0 1h3M1 0v3" stroke="#6f816e" strokeWidth=".25" opacity=".22" />
        </pattern>
        <clipPath id={`${id}-visor`}>
          <path d="M189 47C228 38 258 62 266 104C277 160 260 202 226 219C206 228 188 212 176 188C162 159 160 108 167 80C171 61 179 50 189 47Z" />
        </clipPath>
        <mask id={`${id}-base-fade`}><rect width="360" height="400" fill={fill("fade")} /></mask>
      </defs>
      <g mask={fill("base-fade")}>
        {/* The shoulder, articulated cuff seam, and layered protective bib. */}
        <path d="M135 247C113 258 87 266 69 289C46 320 42 360 32 400H317C309 355 300 300 272 273L240 248Z" fill={fill("cloth")} />
        <path d="M135 247C113 258 87 266 69 289C46 320 42 360 32 400H317C309 355 300 300 272 273L240 248Z" fill={fill("weave")} />
        <path d="M164 189C153 211 137 225 129 247C137 271 171 288 216 285C242 282 259 267 264 250L237 205Z" fill={fill("rim")} />
        <path d="M157 201C151 223 145 240 146 251C168 269 214 274 245 254L230 220" fill="none" stroke="#8e9d88" strokeWidth="2" opacity=".55" />
        <path d="M160 264C170 293 171 341 175 400M83 278C109 305 111 354 114 400" fill="none" stroke="#99a890" strokeWidth="1" opacity=".6" />
        <path d="M192 284C213 317 218 362 219 400" fill="none" stroke="#ffffff" strokeWidth="2" opacity=".8" />
        {/* A three-quarter metallic grille, with a real repeated wire weave. */}
        <path d="M182 34C226 22 266 51 276 104C289 164 270 210 230 232C204 246 177 220 161 191C142 157 140 105 151 72C158 48 168 38 182 34Z" fill={fill("rim")} />
        <path d="M176 43C155 81 151 145 169 191C178 215 193 229 208 233C182 221 164 193 158 161C149 113 155 65 176 43Z" fill="#465440" opacity=".75" />
        <g clipPath={fill("visor")}>
          <rect x="150" y="30" width="140" height="210" fill={fill("face")} />
          <rect x="150" y="30" width="140" height="210" fill={fill("mesh")} />
          <rect x="150" y="30" width="140" height="210" fill={fill("sheen")} />
          <path d="M212 35C194 72 193 183 220 232M248 42C232 93 238 175 250 214" fill="none" stroke="#f7f9e8" strokeWidth="1" opacity=".24" />
        </g>
        <path d="M189 47C228 38 258 62 266 104C277 160 260 202 226 219C206 228 188 212 176 188C162 159 160 108 167 80C171 61 179 50 189 47Z" fill="none" stroke="#d5ddc8" strokeWidth="1.5" />
        <path d="M187 40C229 30 266 61 272 107" fill="none" stroke="#fcfff0" strokeWidth="2" opacity=".85" />
        <path d="M144 234 135 242 146 253" fill="none" stroke="#5b6d54" strokeWidth="3" />
        <circle cx="259" cy="166" r="11" fill="#efff8c" opacity=".12" />
        <circle cx="259" cy="166" r="3" className="study-signal" />
        <path d="M272 166h32l12-12h22" fill="none" stroke="#87957c" strokeWidth=".6" opacity=".7" />
      </g>
    </svg>
  );
}
