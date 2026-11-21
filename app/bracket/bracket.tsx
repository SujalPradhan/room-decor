"use client";
import dynamic from "next/dynamic";
const Page=dynamic(()=>import("../../src/bracket/BracketPage"),{ssr:false,loading:()=> <div className="studio-boot" role="status">Opening…</div>});
export default function Bracket(){return <Page/>;}
