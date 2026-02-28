"use client"
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"

export default function Home() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loginStatus, setLoginStatus] = useState({
    douyin: false,
    bilibili: false,
    xiaohongshu: false,
    youtube: true,
  })
  const [isLoggingIn, setIsLoggingIn] = useState<string | null>(null)
  
  const [platforms, setPlatforms] = useState({
    douyin: false,
    bilibili: false,
    xiaohongshu: false,
    youtube: false,
  })

  const [publishResults, setPublishResults] = useState<{platform: string, success: boolean, message: string}[] | null>(null)

  useEffect(() => {
    fetchLoginStatus()
  }, [])

  const fetchLoginStatus = async () => {
    try {
      const res = await fetch('/api/auth/status')
      const data = await res.json()
      setLoginStatus(data)
    } catch (e) {
      console.error('Failed to fetch login status')
    }
  }

  const handleLogin = async (platform: string) => {
    if (platform === 'youtube') return
    
    setIsLoggingIn(platform)
    try {
      alert(`浏览器即将打开，请在打开的页面中扫码或输入密码登录 ${platform}。\n登录完成后关闭页面即可保存凭据。`)
      const res = await fetch(`/api/auth/${platform}`, { method: 'POST' })
      if (res.ok) {
        await fetchLoginStatus()
        alert('登录状态已保存！')
      } else {
        alert('登录失败，请重试')
      }
    } catch (e) {
      alert('网络错误，无法启动登录进程')
    } finally {
      setIsLoggingIn(null)
    }
  }

  const handlePlatformChange = (platform: keyof typeof platforms) => {
    if (!loginStatus[platform]) {
      alert(`请先登录 ${platform} 账号`)
      return
    }
    setPlatforms(prev => ({ ...prev, [platform]: !prev[platform] }))
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsSubmitting(true)
    setPublishResults(null)
    
    const form = e.currentTarget
    const selectedPlatforms = Object.entries(platforms).filter(([_, isSelected]) => isSelected).map(([key]) => key)
    
    if (selectedPlatforms.length === 0) {
      alert("请至少选择一个发布平台")
      setIsSubmitting(false)
      return
    }

    const fileInput = form.elements.namedItem('file') as HTMLInputElement
    const file = fileInput.files?.[0]
    if (!file) {
      alert("请先选择要上传的媒体文件")
      setIsSubmitting(false)
      return
    }

    const formData = new FormData()
    formData.append('title', (form.elements.namedItem('title') as HTMLInputElement).value)
    formData.append('description', (form.elements.namedItem('description') as HTMLTextAreaElement).value)
    formData.append('tags', (form.elements.namedItem('tags') as HTMLInputElement).value)
    formData.append('file', file)
    formData.append('platforms', JSON.stringify(platforms))

    try {
      const response = await fetch('/api/publish', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (data.results) {
        setPublishResults(data.results)
      } else {
        alert(data.error || '发布失败')
      }
    } catch (error) {
      console.error('Publishing failed', error)
      alert('发布请求发送失败，请检查网络。')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Account Management Section */}
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-gray-900">账号管理</CardTitle>
            <CardDescription>在发布前，请先授权您的账号。基于 Playwright 自动化登录。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { id: 'douyin', name: '抖音' },
                { id: 'bilibili', name: 'B站' },
                { id: 'xiaohongshu', name: '小红书' },
                { id: 'youtube', name: 'YouTube' }
              ].map(p => (
                <div key={p.id} className="flex flex-col items-center justify-center p-4 border rounded-lg bg-white shadow-sm space-y-3">
                  <span className="font-semibold">{p.name}</span>
                  <div className="flex flex-col items-center space-y-2 w-full">
                    {loginStatus[p.id as keyof typeof loginStatus] ? (
                      <span className="text-green-600 text-sm font-medium px-2 py-1 bg-green-50 rounded-full border border-green-200">已连接</span>
                    ) : (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full text-xs"
                        onClick={() => handleLogin(p.id)}
                        disabled={isLoggingIn !== null}
                      >
                        {isLoggingIn === p.id ? '登录中...' : '点击登录'}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Publishing Form */}
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
                <Input name="title" id="title" required placeholder="请输入引人注目的标题..." />
              </div>

              <div className="space-y-2">
                <label htmlFor="description" className="text-sm font-medium leading-none">
                  内容描述 <span className="text-red-500">*</span>
                </label>
                <Textarea name="description" id="description" required placeholder="请填写详细的内容描述，支持添加相关的话题标签等信息..." className="min-h-[120px]" />
              </div>

              <div className="space-y-2">
                <label htmlFor="tags" className="text-sm font-medium leading-none">
                  标签 (Tags)
                </label>
                <Input name="tags" id="tags" placeholder="例如: 科技, 数码, 评测 (用逗号分隔)" />
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
                    <input name="file" id="dropzone-file" type="file" className="hidden" accept="video/mp4,video/quicktime,image/jpeg,image/png" required />
                  </label>
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t">
                <label className="text-base font-semibold">
                  选择分发平台 <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="flex items-center space-x-2 bg-white p-3 rounded-md border shadow-sm opacity-100">
                    <Checkbox id="douyin" disabled={!loginStatus.douyin} checked={platforms.douyin} onCheckedChange={() => handlePlatformChange('douyin')} />
                    <label htmlFor="douyin" className={`text-sm font-medium leading-none ${!loginStatus.douyin ? 'text-gray-400 cursor-not-allowed' : 'cursor-pointer'}`}>抖音</label>
                  </div>
                  <div className="flex items-center space-x-2 bg-white p-3 rounded-md border shadow-sm">
                    <Checkbox id="bilibili" disabled={!loginStatus.bilibili} checked={platforms.bilibili} onCheckedChange={() => handlePlatformChange('bilibili')} />
                    <label htmlFor="bilibili" className={`text-sm font-medium leading-none ${!loginStatus.bilibili ? 'text-gray-400 cursor-not-allowed' : 'cursor-pointer'}`}>B站 (Bilibili)</label>
                  </div>
                  <div className="flex items-center space-x-2 bg-white p-3 rounded-md border shadow-sm">
                    <Checkbox id="xiaohongshu" disabled={!loginStatus.xiaohongshu} checked={platforms.xiaohongshu} onCheckedChange={() => handlePlatformChange('xiaohongshu')} />
                    <label htmlFor="xiaohongshu" className={`text-sm font-medium leading-none ${!loginStatus.xiaohongshu ? 'text-gray-400 cursor-not-allowed' : 'cursor-pointer'}`}>小红书</label>
                  </div>
                  <div className="flex items-center space-x-2 bg-white p-3 rounded-md border shadow-sm">
                    <Checkbox id="youtube" disabled={!loginStatus.youtube} checked={platforms.youtube} onCheckedChange={() => handlePlatformChange('youtube')} />
                    <label htmlFor="youtube" className={`text-sm font-medium leading-none ${!loginStatus.youtube ? 'text-gray-400 cursor-not-allowed' : 'cursor-pointer'}`}>YouTube</label>
                  </div>
                </div>
              </div>
            </form>

            {publishResults && (
              <div className="mt-8 pt-6 border-t">
                <h3 className="text-lg font-bold mb-4">发布结果</h3>
                <div className="space-y-3">
                  {publishResults.map((result, idx) => (
                    <div key={idx} className={`p-4 rounded-md border ${result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                      <div className="flex items-center">
                        <div className={`font-bold mr-2 ${result.success ? 'text-green-700' : 'text-red-700'}`}>
                          {result.platform === 'douyin' && '抖音'}
                          {result.platform === 'bilibili' && 'B站'}
                          {result.platform === 'xiaohongshu' && '小红书'}
                          {result.platform === 'youtube' && 'YouTube'}:
                        </div>
                        <span className="text-gray-700">{result.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="bg-gray-50 flex justify-end p-6 border-t rounded-b-lg">
            <Button type="submit" form="publish-form" className="w-full sm:w-auto text-lg px-8 py-6" disabled={isSubmitting}>
              {isSubmitting ? "正在自动化发布中 (这可能需要几分钟)..." : "一键发布"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
