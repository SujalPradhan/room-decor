"use client";
import dynamic from "next/dynamic";
const Page=dynamic(()=>import("../../src/tower/TowerPage"),{ssr:false,loading:()=> <div className="studio-boot" role="status">Opening…</div>});
export default function Tower(){return <Page/>;}
