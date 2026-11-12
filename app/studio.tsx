"use client";
import dynamic from "next/dynamic";
const Editor=dynamic(()=>import("../src/App"),{ssr:false,loading:()=> <div className="studio-boot" role="status">Opening your room…</div>});
export default function Studio(){return <Editor/>;}
