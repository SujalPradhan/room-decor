import type { ReactNode } from "react";
import "../src/style.css";
export const metadata={title:"Roomshift — Make room for possibility",description:"Arrange furniture, try products and track processing cost and time."};
export default function Layout({children}:{children:ReactNode}){return <html lang="en"><head><meta name="theme-color" content="#202a25"/><link rel="stylesheet" href="/assets/fonts/fonts.css"/><link rel="icon" href="/favicon.svg" type="image/svg+xml"/></head><body><div id="root">{children}</div></body></html>;}
