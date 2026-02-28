"use client"
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { FileIcon, ImageIcon, VideoIcon, XIcon, CheckCircleIcon, XCircleIcon } from "lucide-react"
import { PublishTask, SocialPlatform } from "@/lib/db"

export default function Home() {
  const [activeTab, setActiveTab] = useState<'publish' | 'history'>('publish')
  
  // Publish State
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState<string | null>(null)
  
  const [dbPlatforms, setDbPlatforms] = useState<SocialPlatform[]>([])
  
  // Map of selected platforms for the publishing form
  const [platforms, setPlatforms] = useState<Record<string, boolean>>({})

  // History State
  const [tasks, setTasks] = useState<PublishTask[]>([])
  const [selectedTask, setSelectedTask] = useState<PublishTask | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  useEffect(() => {
    fetchLoginStatus()
    fetchTasks()
  }, [])

  const fetchLoginStatus = async () => {
    try {
      const res = await fetch('/api/auth/status')
      const data: SocialPlatform[] = await res.json()
      if (Array.isArray(data)) {
        setDbPlatforms(data)
        
        // Initialize local checkboxes state based on db data
        setPlatforms(prev => {
          const newState = { ...prev }
          data.forEach(p => {
            if (!(p.id in newState)) newState[p.id] = false;
          })
          return newState;
        })
      }
    } catch (e) {
      console.error('Failed to fetch platform status')
    }
  }

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/tasks')
      const data = await res.json()
      setTasks(data)
    } catch (e) {
      console.error('Failed to fetch tasks')
    }
  }

  const handleLogin = async (platformId: string) => {
    setIsLoggingIn(platformId)
    try {
      alert(`浏览器即将打开，请在打开的页面中扫码或输入密码登录。\n登录完成后关闭页面即可保存凭据并自动更新状态到数据库。`)
      const res = await fetch(`/api/auth/${platformId}`, { method: 'POST' })
      if (res.ok) {
        await fetchLoginStatus()
        alert('登录状态已同步到数据库！')
      } else {
        alert('登录失败，请重试')
      }
    } catch (e) {
      alert('网络错误，无法启动登录进程')
    } finally {
      setIsLoggingIn(null)
    }
  }

  const handlePlatformChange = (platformId: string) => {
    const plat = dbPlatforms.find(p => p.id === platformId)
    if (!plat?.isConnected) {
      alert(`请先登录 ${plat?.name} 账号`)
      return
    }
    setPlatforms(prev => ({ ...prev, [platformId]: !prev[platformId] }))
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0])
    }
  }

  const clearFile = () => {
    setSelectedFile(null)
    const fileInput = document.getElementById('dropzone-file') as HTMLInputElement
    if (fileInput) fileInput.value = ''
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsSubmitting(true)
    
    const form = e.currentTarget
    const selectedPlatforms = Object.entries(platforms).filter(([_, isSelected]) => isSelected).map(([key]) => key)
    
    if (selectedPlatforms.length === 0) {
      alert("请至少选择一个发布平台")
      setIsSubmitting(false)
      return
    }

    if (!selectedFile) {
      alert("请先选择要上传的媒体文件")
      setIsSubmitting(false)
      return
    }

    const formData = new FormData()
    formData.append('title', (form.elements.namedItem('title') as HTMLInputElement).value)
    formData.append('description', (form.elements.namedItem('description') as HTMLTextAreaElement).value)
    formData.append('tags', (form.elements.namedItem('tags') as HTMLInputElement).value)
    formData.append('file', selectedFile)
    formData.append('platforms', JSON.stringify(platforms))

    try {
      const response = await fetch('/api/publish', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (data.task) {
        await fetchTasks()
        setSelectedTask(data.task)
        setActiveTab('history')
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

  const getFileIcon = () => {
    if (!selectedFile) return null
    if (selectedFile.type.startsWith('image/')) return <ImageIcon className="w-8 h-8 text-blue-500" />
    if (selectedFile.type.startsWith('video/')) return <VideoIcon className="w-8 h-8 text-blue-500" />
    return <FileIcon className="w-8 h-8 text-blue-500" />
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <div className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-center space-x-8">
            <button
              onClick={() => setActiveTab('publish')}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'publish'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              一键发布
            </button>
            <button
              onClick={() => { setActiveTab('history'); setSelectedTask(null); }}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'history'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              发布历史与日志
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* ==================== PUBLISH TAB ==================== */}
        {activeTab === 'publish' && (
          <div className="space-y-8">
            <Card className="w-full">
              <CardHeader>
                <CardTitle className="text-2xl font-bold text-gray-900">账号管理</CardTitle>
                <CardDescription>在发布前，请先授权您的账号。登录状态由云端数据库管理。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {dbPlatforms.length === 0 ? (
                    <div className="col-span-4 text-center text-sm text-gray-500 py-4">正在从数据库加载支持的平台列表...</div>
                  ) : (
                    dbPlatforms.map(p => (
                      <div key={p.id} className="flex flex-col items-center justify-center p-4 border rounded-lg bg-white shadow-sm space-y-3">
                        <span className="font-semibold">{p.name}</span>
                        <div className="flex flex-col items-center space-y-2 w-full">
                          {p.isConnected ? (
                            <div className="flex flex-col items-center text-center">
                              <span className="text-green-600 text-sm font-medium px-2 py-1 bg-green-50 rounded-full border border-green-200">已连接</span>
                              {p.lastLoginAt && (
                                <span className="text-[10px] text-gray-400 mt-1">最后登录: {new Date(p.lastLoginAt).toLocaleDateString()}</span>
                              )}
                            </div>
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
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="w-full">
              <CardHeader>
                <CardTitle className="text-3xl font-bold text-center text-gray-900">
                  新建发布任务
                </CardTitle>
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
                    <Textarea name="description" id="description" required placeholder="请填写详细的内容描述..." className="min-h-[120px]" />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="tags" className="text-sm font-medium leading-none">
                      标签 (Tags)
                    </label>
                    <Input name="tags" id="tags" placeholder="例如: 科技, 数码, 评测 (用逗号分隔)" />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium leading-none">
                      上传媒体文件 <span className="text-red-500">*</span>
                    </label>
                    <div className="flex items-center justify-center w-full">
                      {!selectedFile ? (
                        <label htmlFor="dropzone-file" className="flex flex-col items-center justify-center w-full h-40 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <p className="mb-2 text-sm text-gray-500"><span className="font-semibold text-blue-600">点击上传</span> 或拖拽文件</p>
                            <p className="text-xs text-gray-500">MP4, MOV, PNG, JPG (最大 2GB)</p>
                          </div>
                          <input name="file" id="dropzone-file" type="file" className="hidden" accept="video/mp4,video/quicktime,image/jpeg,image/png" required onChange={handleFileChange} />
                        </label>
                      ) : (
                        <div className="flex flex-col items-center justify-center w-full h-40 border-2 border-blue-300 border-solid rounded-lg bg-blue-50 relative">
                          <button type="button" onClick={clearFile} className="absolute top-2 right-2 p-1 bg-white rounded-full text-gray-500 hover:text-red-500 shadow-sm" title="移除文件">
                            <XIcon className="w-5 h-5" />
                          </button>
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            {getFileIcon()}
                            <p className="mt-3 text-sm font-medium text-gray-900 truncate max-w-[250px]">{selectedFile.name}</p>
                            <p className="text-xs text-gray-500 mt-1">{formatFileSize(selectedFile.size)}</p>
                            <label htmlFor="dropzone-file" className="mt-4 text-xs font-semibold text-blue-600 cursor-pointer hover:underline">更换文件</label>
                            <input name="file" id="dropzone-file" type="file" className="hidden" accept="video/mp4,video/quicktime,image/jpeg,image/png" onChange={handleFileChange} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 pt-4 border-t">
                    <label className="text-base font-semibold">选择分发平台 <span className="text-red-500">*</span></label>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      {dbPlatforms.map((plat) => (
                        <div key={plat.id} className="flex items-center space-x-2 bg-white p-3 rounded-md border shadow-sm">
                          <Checkbox id={plat.id} disabled={!plat.isConnected} checked={platforms[plat.id] || false} onCheckedChange={() => handlePlatformChange(plat.id)} />
                          <label htmlFor={plat.id} className={`text-sm font-medium leading-none ${!plat.isConnected ? 'text-gray-400 cursor-not-allowed' : 'cursor-pointer'}`}>
                            {plat.name}
                          </label>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">提示：由数据库动态提供支持平台。必须先在账号管理中登录，才能选择对应的平台。</p>
                  </div>
                </form>
              </CardContent>
              <CardFooter className="bg-gray-50 flex justify-end p-6 border-t rounded-b-lg">
                <Button type="submit" form="publish-form" className="w-full sm:w-auto text-lg px-8 py-6" disabled={isSubmitting}>
                  {isSubmitting ? "自动化发布中 (这可能需要几分钟)..." : "一键发布"}
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}

        {/* ==================== HISTORY TAB ==================== */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            {!selectedTask ? (
              <div className="grid gap-4">
                {tasks.length === 0 ? (
                  <div className="text-center py-12 text-gray-500 bg-white border rounded-lg">暂无发布历史记录</div>
                ) : (
                  tasks.map(task => (
                    <Card key={task.id} className="hover:border-blue-300 transition-colors cursor-pointer" onClick={() => setSelectedTask(task)}>
                      <CardHeader className="py-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <CardTitle className="text-lg">{task.title}</CardTitle>
                            <CardDescription className="mt-1">{new Date(task.createdAt).toLocaleString()}</CardDescription>
                          </div>
                          <div className={`px-2.5 py-0.5 rounded-full text-xs font-semibold
                            ${task.status === 'completed' ? 'bg-green-100 text-green-800' : 
                              task.status === 'failed' ? 'bg-red-100 text-red-800' : 
                              'bg-yellow-100 text-yellow-800'}`}
                          >
                            {task.status === 'completed' ? '已完成' : task.status === 'failed' ? '部分/全部失败' : '处理中'}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="py-2 pb-4">
                        <div className="flex flex-wrap gap-2 mt-2">
                          {task.results?.map(res => (
                            <span key={res.platform} className={`text-xs px-2 py-1 rounded-md border flex items-center space-x-1 ${res.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                              {res.success ? <CheckCircleIcon className="w-3 h-3 text-green-600" /> : <XCircleIcon className="w-3 h-3 text-red-600" />}
                              <span>{res.platform}</span>
                            </span>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-6">
                <Button variant="outline" onClick={() => setSelectedTask(null)} className="mb-4">
                  ← 返回列表
                </Button>
                
                <Card>
                  <CardHeader className="bg-gray-50 border-b">
                    <CardTitle className="text-xl">{selectedTask.title}</CardTitle>
                    <CardDescription>{new Date(selectedTask.createdAt).toLocaleString()} • {selectedTask.platforms.join(', ')}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {selectedTask.results.map(res => (
                        <div key={res.platform} className="p-6">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold uppercase">{res.platform}</h3>
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${res.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                              {res.success ? '成功' : '失败'}
                            </span>
                          </div>
                          
                          <p className={`text-sm mb-6 p-3 rounded-md border ${res.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                            {res.message}
                          </p>

                          <div className="space-y-4">
                            {res.logs && res.logs.length > 0 && (
                              <div className="bg-gray-900 rounded-md p-4 overflow-x-auto">
                                <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">执行日志</h4>
                                <div className="font-mono text-xs text-gray-300 space-y-1">
                                  {res.logs.map((log, i) => (
                                    <div key={i}>{log}</div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {res.screenshots && res.screenshots.length > 0 && (
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-3 border-b pb-2">自动化调试截图 (Timeline)</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                  {res.screenshots.map((src, i) => (
                                    <div key={i} className="group relative rounded-lg overflow-hidden border bg-gray-100 aspect-video">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={src} alt={`Step ${i+1}`} className="object-cover w-full h-full" />
                                      <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] p-1 truncate">
                                        Step {i+1}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
