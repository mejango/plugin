import {notFound} from 'next/navigation';
import {juiceboxProjectUrl} from '@/lib/juicebox-project';
export const metadata={title:'Juicebox — plugin.money'};
export default async function ProjectBrowserPage({params}:{params:Promise<{chain:string;projectId:string}>}){
 const {chain,projectId}=await params;
 if(!juiceboxProjectUrl(`/browse/${chain}/${projectId}`))notFound();
 return null;
}
