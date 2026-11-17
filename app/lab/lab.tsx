"use client";
import dynamic from "next/dynamic";
const Page=dynamic(()=>import("../../src/lab/LabPage"),{ssr:false,loading:()=> <div className="studio-boot" role="status">Opening…</div>});
export default function Lab(){return <Page/>;}
