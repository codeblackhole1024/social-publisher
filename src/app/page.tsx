"use client"
import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"

export default function Home() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [platforms, setPlatforms] = useState({
    douyin: false,
    bilibili: false,
    xiaohongshu: false,
    youtube: false,
  })

  const handlePlatformChange = (platform: keyof typeof platforms) => {
    setPlatforms(prev => ({ ...prev, [platform]: !prev[platform] }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    
    const selectedPlatforms = Object.entries(platforms).filter(([_, isSelected]) => isSelected).map(([key]) => key)
    
    if (selectedPlatforms.length === 0) {
      alert("请至少选择一个发布平台")
      setIsSubmitting(false)
      return
    }

    console.log("Submitting to:", selectedPlatforms)
    setTimeout(() => {
      setIsSubmitting(false)
      alert("提交发布任务成功！")
    }, 1500)
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl mx-auto">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-3xl font-bold text-center text-gray-900">
              一键分发自媒体平台
            </CardTitle>
            <CardDescription className="text-center text-lg mt-2">
              填写一次内容，自动发布到抖音、B站、小红书和YouTube
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form id="publish-form" onSubmit={handleSubmit} className="space-y-6">
              
              <div className="space-y-2">
                <label htmlFor="title" className="text-sm font-medium leading-none">
                  视频/图文标题 <span className="text-red-500">*</span>
                </label>
                <Input id="title" required placeholder="请输入引人注目的标题..." />
              </div>

              <div className="space-y-2">
                <label htmlFor="description" className="text-sm font-medium leading-none">
                  内容描述 <span className="text-red-500">*</span>
                </label>
                <Textarea id="description" required placeholder="请填写详细的内容描述，支持添加相关的话题标签等信息..." className="min-h-[120px]" />
              </div>

              <div className="space-y-2">
                <label htmlFor="tags" className="text-sm font-medium leading-none">
                  标签 (Tags)
                </label>
                <Input id="tags" placeholder="例如: 科技, 数码, 评测 (用逗号分隔)" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">
                  上传媒体文件 (视频/图片) <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center justify-center w-full">
                  <label htmlFor="dropzone-file" className="flex flex-col items-center justify-center w-full h-40 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <p className="mb-2 text-sm text-gray-500"><span className="font-semibold">点击上传</span> 或拖拽文件到这里</p>
                      <p className="text-xs text-gray-500">MP4, MOV, PNG, JPG (最大 2GB)</p>
                    </div>
                    <input id="dropzone-file" type="file" className="hidden" accept="video/mp4,video/quicktime,image/jpeg,image/png" />
                  </label>
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t">
                <label className="text-base font-semibold">
                  选择分发平台 <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="flex items-center space-x-2 bg-white p-3 rounded-md border shadow-sm">
                    <Checkbox id="douyin" checked={platforms.douyin} onCheckedChange={() => handlePlatformChange('douyin')} />
                    <label htmlFor="douyin" className="text-sm font-medium leading-none cursor-pointer">抖音</label>
                  </div>
                  <div className="flex items-center space-x-2 bg-white p-3 rounded-md border shadow-sm">
                    <Checkbox id="bilibili" checked={platforms.bilibili} onCheckedChange={() => handlePlatformChange('bilibili')} />
                    <label htmlFor="bilibili" className="text-sm font-medium leading-none cursor-pointer">B站 (Bilibili)</label>
                  </div>
                  <div className="flex items-center space-x-2 bg-white p-3 rounded-md border shadow-sm">
                    <Checkbox id="xiaohongshu" checked={platforms.xiaohongshu} onCheckedChange={() => handlePlatformChange('xiaohongshu')} />
                    <label htmlFor="xiaohongshu" className="text-sm font-medium leading-none cursor-pointer">小红书</label>
                  </div>
                  <div className="flex items-center space-x-2 bg-white p-3 rounded-md border shadow-sm">
                    <Checkbox id="youtube" checked={platforms.youtube} onCheckedChange={() => handlePlatformChange('youtube')} />
                    <label htmlFor="youtube" className="text-sm font-medium leading-none cursor-pointer">YouTube</label>
                  </div>
                </div>
              </div>
            </form>
          </CardContent>
          <CardFooter className="bg-gray-50 flex justify-end p-6 border-t rounded-b-lg">
            <Button type="submit" form="publish-form" className="w-full sm:w-auto text-lg px-8 py-6" disabled={isSubmitting}>
              {isSubmitting ? "处理中..." : "一键发布"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
